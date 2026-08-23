import {
  cancelMeetingBooking,
  rescheduleMeetingBooking,
} from "@vercentlabs/api";
import { crmCommunicationsErrorResponse } from "@/modules/crm/server/communications";
import { query, tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function PATCH(
  request: Request,
  route: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await route.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) {
      throw new HttpError(404, "Meeting booking not found.");
    }
    const rows = await query<{
      organization_id: string;
      booking_id: string;
      host_user_id: string;
      token_type: string;
    }>("SELECT * FROM tenant.crm_public_meeting_booking($1)", [token]);
    const booking = rows[0];
    if (!booking) throw new HttpError(404, "Meeting booking not found.");
    const input = (await request.json()) as Record<string, unknown>;
    const context = {
      organizationId: booking.organization_id,
      userId: booking.host_user_id,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    };
    const result = await tenantTransaction(booking.organization_id, (client) =>
      booking.token_type === "cancel"
        ? cancelMeetingBooking(
            client,
            context,
            booking.booking_id,
            String(input.reason || ""),
          )
        : rescheduleMeetingBooking(client, context, booking.booking_id, input),
    );
    return ok({ booking: result });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
