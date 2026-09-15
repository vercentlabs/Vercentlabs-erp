import { cancelMeetingBooking, rescheduleMeetingBooking } from "@vercentlabs/api";

import { query, tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// app/api/crm/public/meetings/bookings/[token]/route.ts (F014). Public,
// unauthenticated by design (a prospect cancelling/rescheduling their own
// booked meeting) — access control is entirely the opaque per-booking
// token, resolved via the existing tenant.crm_public_meeting_booking() DB
// function, never a guessable sequential id.
export async function PATCH(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) throw new HttpError(404, "Meeting booking not found.");

    const rows = await query<{
      organization_id: string;
      booking_id: string;
      host_user_id: string;
      token_type: string;
    }>("SELECT * FROM tenant.crm_public_meeting_booking($1)", [token]);
    const booking = rows[0];
    if (!booking) throw new HttpError(404, "Meeting booking not found.");

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
