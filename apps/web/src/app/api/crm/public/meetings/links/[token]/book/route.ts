import {
  bookMeeting,
  publicMeetingContext,
  resolvePublicMeetingLink,
} from "@vercentlabs/api/crm";
import { createLogger } from "@vercentlabs/observability";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { enforcePublicRateLimits } from "@/core/public-rate-limit";
import { errorResponse, ok, readJson } from "@/core/http";
import { publicMeetingLimits } from "@/features/crm/public-booking/public-limits";

type RouteContext = { params: Promise<{ token: string }> };

const logger = createLogger("web-crm-public-booking");

// F014 a guest books a slot. Delegates entirely to bookMeeting, which
// re-validates availability under a row lock at commit time — no separate
// public booking path. The outcome event carries no guest data.
export async function POST(request: Request, context: RouteContext) {
  const started = Date.now();
  let organizationId: string | null = null;
  try {
    const { token } = await context.params;
    await enforcePublicRateLimits(request, publicMeetingLimits.book(token));
    const link = await withIngressClient((client) =>
      resolvePublicMeetingLink(client, token),
    );
    organizationId = link.organization_id;
    const input = (await readJson(request)) as Record<string, unknown>;
    const booking = await tenantTransaction(link.organization_id, (client) =>
      bookMeeting(
        client,
        publicMeetingContext({
          organizationId: link.organization_id,
          hostUserId: link.owner_user_id,
        }),
        link.meeting_link_id,
        input,
      ),
    );
    logger.event("crm.public_booking", {
      organizationId,
      outcome: booking.replayed ? "replayed" : "booked",
      durationMs: Date.now() - started,
    });
    return ok({ booking }, 201);
  } catch (error) {
    const failure = error as { status?: number; code?: string };
    logger.event(
      "crm.public_booking",
      {
        organizationId,
        outcome: "refused",
        status: failure?.status ?? 500,
        errorCode: failure?.code ?? null,
        durationMs: Date.now() - started,
      },
      (failure?.status ?? 500) >= 500 ? "error" : "info",
    );
    return errorResponse(error);
  }
}
