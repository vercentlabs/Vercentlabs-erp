import { assertPublicDate, getMeetingAvailability, publicMeetingContext, resolvePublicMeetingLink } from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";

type RouteContext = { params: Promise<{ token: string }> };

// F014 free slots for a public booking link: the same getMeetingAvailability
// an authenticated caller uses (no second slot engine), under the anonymous
// host context of the resolved organisation.
export async function GET(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const date = assertPublicDate(new URL(request.url).searchParams.get("date"));
    const link = await withIngressClient((client) => resolvePublicMeetingLink(client, token));
    const slots = await tenantTransaction(link.organization_id, (client) =>
      getMeetingAvailability(client, publicMeetingContext({ organizationId: link.organization_id, hostUserId: link.owner_user_id }), link.meeting_link_id, date),
    );
    return ok({ slots });
  } catch (error) {
    return errorResponse(error);
  }
}
