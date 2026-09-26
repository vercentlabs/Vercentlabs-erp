import { bookMeeting, publicMeetingContext, resolvePublicMeetingLink } from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";

type RouteContext = { params: Promise<{ token: string }> };

// F014 a guest books a slot. Delegates entirely to bookMeeting, which
// re-validates availability under a row lock at commit time — no separate
// public booking path.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const link = await withIngressClient((client) => resolvePublicMeetingLink(client, token));
    const input = (await readJson(request)) as Record<string, unknown>;
    const booking = await tenantTransaction(link.organization_id, (client) =>
      bookMeeting(client, publicMeetingContext({ organizationId: link.organization_id, hostUserId: link.owner_user_id }), link.meeting_link_id, input),
    );
    return ok({ booking }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
