import {
  cancelMeetingBooking,
  getPublicMeetingBookingView,
  publicMeetingContext,
  rescheduleMeetingBooking,
  resolvePublicMeetingBooking,
} from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { enforcePublicRateLimits } from "@/core/public-rate-limit";
import { errorResponse, ok, readJson } from "@/core/http";
import { publicMeetingLimits } from "@/features/crm/public-booking/public-limits";

type RouteContext = { params: Promise<{ token: string }> };

// F014 manage-booking page. Public by design: the per-booking token (resolved
// by tenant.crm_public_meeting_booking, no context) says which action it
// authorizes (token_type), so the UI never has to guess.
export async function GET(request: Request, context: RouteContext) {
  try {
    await enforcePublicRateLimits(request, publicMeetingLimits.view());
    const { token } = await context.params;
    const booking = await withIngressClient((client) =>
      resolvePublicMeetingBooking(client, token),
    );
    const view = await tenantTransaction(booking.organization_id, (client) =>
      getPublicMeetingBookingView(client, booking),
    );
    return ok({ booking: view });
  } catch (error) {
    return errorResponse(error);
  }
}

// Cancel or reschedule, whichever the token authorizes, through the same
// domain functions the host uses.
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    await enforcePublicRateLimits(request, publicMeetingLimits.manage(token));
    const booking = await withIngressClient((client) =>
      resolvePublicMeetingBooking(client, token),
    );
    const input = (await readJson(request)) as Record<string, unknown>;
    const host = publicMeetingContext({
      organizationId: booking.organization_id,
      hostUserId: booking.host_user_id,
    });
    const result = await tenantTransaction(booking.organization_id, (client) =>
      booking.token_type === "cancel"
        ? cancelMeetingBooking(
            client,
            host,
            booking.booking_id,
            String(input.reason || ""),
          )
        : rescheduleMeetingBooking(client, host, booking.booking_id, input),
    );
    return ok({ booking: result });
  } catch (error) {
    return errorResponse(error);
  }
}
