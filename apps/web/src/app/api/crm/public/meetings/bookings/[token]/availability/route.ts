import {
  getPublicRescheduleAvailability,
  resolvePublicMeetingBooking,
} from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { enforcePublicRateLimits } from "@/core/public-rate-limit";
import { errorResponse, ok } from "@/core/http";
import { publicMeetingLimits } from "@/features/crm/public-booking/public-limits";

type RouteContext = { params: Promise<{ token: string }> };

// F014 slots to reschedule a booking into (reschedule tokens only; the
// booking's own slot is excluded).
export async function GET(request: Request, context: RouteContext) {
  try {
    await enforcePublicRateLimits(request, publicMeetingLimits.slots());
    const { token } = await context.params;
    const date = new URL(request.url).searchParams.get("date");
    const booking = await withIngressClient((client) =>
      resolvePublicMeetingBooking(client, token),
    );
    const slots = await tenantTransaction(booking.organization_id, (client) =>
      getPublicRescheduleAvailability(client, booking, date),
    );
    return ok({ slots });
  } catch (error) {
    return errorResponse(error);
  }
}
