// Public, unauthenticated meeting pages (F014): a prospect opens a host's
// booking link, or manages a booking they made, by an opaque token only.
//
// A token is resolved WITHOUT any organisation context by the database
// functions tenant.crm_public_meeting_link() / crm_public_meeting_booking()
// (SECURITY DEFINER, token -> organisation + ids only). Everything after that
// runs in a tenant transaction for the resolved organisation, using the same
// domain functions an authenticated user uses (availability, booking,
// cancel, reschedule) under an anonymous host context with no permissions.
import { getMeetingAvailability } from "./communications.js";

export class PublicMeetingError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "PublicMeetingError";
    this.status = status;
    this.code = code;
  }
}

const TOKEN = /^[0-9a-f]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const linkNotFound = () => new PublicMeetingError(404, "Meeting link not found.", "CRM_PUBLIC_MEETING_LINK_NOT_FOUND");
const bookingNotFound = () => new PublicMeetingError(404, "Meeting booking not found.", "CRM_PUBLIC_MEETING_BOOKING_NOT_FOUND");

/** Token -> link (organisation, link id, host) with no context. Throws 404. */
export async function resolvePublicMeetingLink(queryable, token) {
  if (!TOKEN.test(String(token || ""))) throw linkNotFound();
  const link = (await queryable.query("SELECT * FROM tenant.crm_public_meeting_link($1)", [token])).rows[0];
  if (!link) throw linkNotFound();
  return link;
}

/** Token -> booking (organisation, booking id, host, token type) with no context. Throws 404. */
export async function resolvePublicMeetingBooking(queryable, token) {
  if (!TOKEN.test(String(token || ""))) throw bookingNotFound();
  const booking = (await queryable.query("SELECT * FROM tenant.crm_public_meeting_booking($1)", [token])).rows[0];
  if (!booking) throw bookingNotFound();
  return booking;
}

/** The anonymous context public pages act under: the host, no permissions. */
export function publicMeetingContext({ organizationId, hostUserId }) {
  return { organizationId, userId: hostUserId, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: [], roleSlugs: [] };
}

export function assertPublicDate(date) {
  if (!date || !DATE.test(String(date))) throw new PublicMeetingError(400, "A valid date is required.", "CRM_PUBLIC_MEETING_DATE_INVALID");
  return String(date);
}

/** What a guest needs to render a booking page (tenant transaction for link.organization_id). */
export async function getPublicMeetingLinkView(client, link) {
  const owner = (await client.query("SELECT full_name FROM public.users WHERE id=$1", [link.owner_user_id])).rows[0];
  return {
    name: link.name,
    ownerName: owner?.full_name || null,
    durationMinutes: link.duration_minutes,
    timezone: link.timezone,
    availability: link.availability,
    meetingProvider: link.meeting_provider,
    locationTemplate: link.location_template,
    minimumNoticeMinutes: link.minimum_notice_minutes,
    maximumDaysAhead: link.maximum_days_ahead,
  };
}

/** Current details of a booking for its manage page (tenant transaction for booking.organization_id). */
export async function getPublicMeetingBookingView(client, booking) {
  const detail = (
    await client.query(
      `SELECT b.starts_at, b.ends_at, b.status, link.name AS meeting_name, link.duration_minutes, link.timezone
         FROM tenant.crm_meeting_bookings b
         JOIN tenant.crm_meeting_links link ON link.organization_id = b.organization_id AND link.id = b.meeting_link_id
        WHERE b.organization_id = $1 AND b.id = $2`,
      [booking.organization_id, booking.booking_id],
    )
  ).rows[0];
  if (!detail) throw bookingNotFound();
  return {
    startsAt: detail.starts_at,
    endsAt: detail.ends_at,
    status: detail.status,
    meetingName: detail.meeting_name,
    durationMinutes: detail.duration_minutes,
    timezone: detail.timezone,
    canCancel: booking.token_type === "cancel",
    canReschedule: booking.token_type === "reschedule",
  };
}

/** Free slots for rescheduling a booking, excluding the booking itself. */
export async function getPublicRescheduleAvailability(client, booking, date) {
  if (booking.token_type !== "reschedule") throw new PublicMeetingError(403, "This link does not allow rescheduling.", "CRM_PUBLIC_MEETING_RESCHEDULE_FORBIDDEN");
  const link = (await client.query("SELECT meeting_link_id FROM tenant.crm_meeting_bookings WHERE organization_id=$1 AND id=$2", [booking.organization_id, booking.booking_id])).rows[0];
  if (!link) throw bookingNotFound();
  return getMeetingAvailability(client, publicMeetingContext({ organizationId: booking.organization_id, hostUserId: booking.host_user_id }), link.meeting_link_id, assertPublicDate(date), {
    excludeBookingId: booking.booking_id,
  });
}
