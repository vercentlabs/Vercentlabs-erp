import { getPublicRescheduleAvailability, resolvePublicMeetingBooking } from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";

type RouteContext = { params: Promise<{ token: string }> };

// F014 slots to reschedule a booking into (reschedule tokens only; the
// booking's own slot is excluded).
export async function GET(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const date = new URL(request.url).searchParams.get("date");
    const booking = await withIngressClient((client) => resolvePublicMeetingBooking(client, token));
    const slots = await tenantTransaction(booking.organization_id, (client) => getPublicRescheduleAvailability(client, booking, date));
    return ok({ slots });
  } catch (error) {
    return errorResponse(error);
  }
}
