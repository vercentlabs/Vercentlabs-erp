import { query, tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

type RouteContext = { params: Promise<{ token: string }> };

type PublicMeetingLinkRow = {
  organization_id: string;
  meeting_link_id: string;
  owner_user_id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  timezone: string;
  availability: unknown;
  meeting_provider: string;
  location_template: string | null;
  minimum_notice_minutes: number;
  maximum_days_ahead: number;
};

// F014 Stage A2 §5. tenant.crm_public_meeting_link(token) (migration 031)
// was already built and already used by cancellation_token/reschedule_token
// lookups' sibling function (crm_public_meeting_booking) — this is the
// FIRST caller of the link-lookup half. Public, unauthenticated by design:
// this is the durable "book a meeting with me" page link (like a Calendly
// link), resolved only by its own opaque public_token, never a guessable
// sequential id. Returns only what a guest needs to render a booking page
// — no organization/company internals beyond the host's display name.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) throw new HttpError(404, "Meeting link not found.");

    const rows = await query<PublicMeetingLinkRow>("SELECT * FROM tenant.crm_public_meeting_link($1)", [token]);
    const link = rows[0];
    if (!link) throw new HttpError(404, "Meeting link not found.");

    const owner = await tenantTransaction(link.organization_id, (client) =>
      client.query<{ full_name: string | null }>("SELECT full_name FROM public.users WHERE id=$1", [link.owner_user_id]),
    );

    return ok({
      link: {
        name: link.name,
        ownerName: owner.rows[0]?.full_name || null,
        durationMinutes: link.duration_minutes,
        timezone: link.timezone,
        availability: link.availability,
        meetingProvider: link.meeting_provider,
        locationTemplate: link.location_template,
        minimumNoticeMinutes: link.minimum_notice_minutes,
        maximumDaysAhead: link.maximum_days_ahead,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
