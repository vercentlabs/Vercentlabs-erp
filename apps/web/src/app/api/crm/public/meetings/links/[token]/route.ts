import {
  getPublicMeetingLinkView,
  resolvePublicMeetingLink,
} from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { enforcePublicRateLimits } from "@/core/public-rate-limit";
import { errorResponse, ok } from "@/core/http";
import { publicMeetingLimits } from "@/features/crm/public-booking/public-limits";

type RouteContext = { params: Promise<{ token: string }> };

// F014 public booking page ("book a meeting with me"). Public and
// unauthenticated by design: the opaque link token is the only credential,
// resolved without any organisation context by tenant.crm_public_meeting_link;
// the page data is then read under that organisation (see
// modules/crm/.../public-meetings.js). Only what a guest needs is returned.
export async function GET(request: Request, context: RouteContext) {
  try {
    await enforcePublicRateLimits(request, publicMeetingLimits.view());
    const { token } = await context.params;
    const link = await withIngressClient((client) =>
      resolvePublicMeetingLink(client, token),
    );
    const view = await tenantTransaction(link.organization_id, (client) =>
      getPublicMeetingLinkView(client, link),
    );
    return ok({ link: view });
  } catch (error) {
    return errorResponse(error);
  }
}
