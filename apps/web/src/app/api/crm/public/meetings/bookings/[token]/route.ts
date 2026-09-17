import { cancelMeetingBooking, rescheduleMeetingBooking } from "@vercentlabs/api";

import { query, tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

type BookingLookupRow = { organization_id: string; booking_id: string; host_user_id: string; token_type: string };

async function resolveToken(token: string): Promise<BookingLookupRow> {
  if (!/^[0-9a-f]{36}$/i.test(token)) throw new HttpError(404, "Meeting booking not found.");
  const rows = await query<BookingLookupRow>("SELECT * FROM tenant.crm_public_meeting_booking($1)", [token]);
  const booking = rows[0];
  if (!booking) throw new HttpError(404, "Meeting booking not found.");
  return booking;
}

// F014 Stage A2 §5. Lets the manage-booking public page show current
// details (time, meeting name, duration, host timezone) before a guest
// decides to cancel or reschedule — the token itself already says which
// action it authorizes (token_type), so the UI never has to guess.
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const booking = await resolveToken(token);
    const rows = await tenantTransaction(booking.organization_id, (client) =>
      client.query<{
        starts_at: string;
        ends_at: string;
        status: string;
        meeting_name: string;
        duration_minutes: number;
        timezone: string;
      }>(
        `SELECT b.starts_at,b.ends_at,b.status,link.name AS meeting_name,link.duration_minutes,link.timezone
           FROM tenant.crm_meeting_bookings b
           JOIN tenant.crm_meeting_links link ON link.organization_id=b.organization_id AND link.id=b.meeting_link_id
          WHERE b.organization_id=$1 AND b.id=$2`,
        [booking.organization_id, booking.booking_id],
      ),
    );
    const detail = rows.rows[0];
    if (!detail) throw new HttpError(404, "Meeting booking not found.");
    return ok({
      booking: {
        startsAt: detail.starts_at,
        endsAt: detail.ends_at,
        status: detail.status,
        meetingName: detail.meeting_name,
        durationMinutes: detail.duration_minutes,
        timezone: detail.timezone,
        canCancel: booking.token_type === "cancel",
        canReschedule: booking.token_type === "reschedule",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// app/api/crm/public/meetings/bookings/[token]/route.ts (F014). Public,
// unauthenticated by design (a prospect cancelling/rescheduling their own
// booked meeting) — access control is entirely the opaque per-booking
// token, resolved via the existing tenant.crm_public_meeting_booking() DB
// function, never a guessable sequential id.
export async function PATCH(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const booking = await resolveToken(token);

    const input = (await request.json()) as Record<string, unknown>;
    const publicContext = {
      organizationId: booking.organization_id,
      userId: booking.host_user_id,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
      permissions: [],
      roleSlugs: [],
    };
    const result = await tenantTransaction(booking.organization_id, (client) =>
      booking.token_type === "cancel"
        ? cancelMeetingBooking(client, publicContext, booking.booking_id, String(input.reason || ""))
        : rescheduleMeetingBooking(client, publicContext, booking.booking_id, input),
    );
    return ok({ booking: result });
  } catch (error) {
    return errorResponse(error);
  }
}
