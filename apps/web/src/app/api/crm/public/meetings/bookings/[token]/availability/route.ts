import { getMeetingAvailability } from "@vercentlabs/api";

import { query, tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

// Public and token-authenticated, like its sibling: a guest rescheduling a booking needs the free slots of the very
// meeting link that booking belongs to. The booking token resolves to the booking, the booking to its link, and the
// slots come from the same getMeetingAvailability every other path uses.
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) throw new HttpError(404, "Meeting booking not found.");
    const date = new URL(request.url).searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "A valid date is required.");

    const rows = await query<{ organization_id: string; booking_id: string; host_user_id: string; token_type: string }>("SELECT * FROM tenant.crm_public_meeting_booking($1)", [token]);
    const booking = rows[0];
    if (!booking) throw new HttpError(404, "Meeting booking not found.");
    if (booking.token_type !== "reschedule") throw new HttpError(403, "This link does not allow rescheduling.");

    const publicContext = { organizationId: booking.organization_id, userId: booking.host_user_id, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: [], roleSlugs: [] };
    const slots = await tenantTransaction(booking.organization_id, async (client) => {
      const link = await client.query<{ meeting_link_id: string }>("SELECT meeting_link_id FROM tenant.crm_meeting_bookings WHERE organization_id=$1 AND id=$2", [booking.organization_id, booking.booking_id]);
      if (!link.rows[0]) throw new HttpError(404, "Meeting booking not found.");
      return getMeetingAvailability(client, publicContext, link.rows[0].meeting_link_id, date, { excludeBookingId: booking.booking_id });
    });
    return ok({ slots });
  } catch (error) {
    return errorResponse(error);
  }
}
