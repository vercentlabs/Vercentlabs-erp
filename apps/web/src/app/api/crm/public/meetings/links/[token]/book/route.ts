import { bookMeeting } from "@vercentlabs/api";

import { query, tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";

type RouteContext = { params: Promise<{ token: string }> };

// F014 Stage A2 §5. Public, unauthenticated by design (a prospect booking
// a slot on a rep's public "book a meeting with me" link). Delegates
// entirely to bookMeeting (communications.js), the SAME function the
// existing token-expiry/calendar-push test suites already exercise and
// which already re-validates availability under a row lock at commit
// time — no separate booking path is introduced here.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) throw new HttpError(404, "Meeting link not found.");

    const rows = await query<{ organization_id: string; meeting_link_id: string; owner_user_id: string }>(
      "SELECT organization_id,meeting_link_id,owner_user_id FROM tenant.crm_public_meeting_link($1)",
      [token],
    );
    const link = rows[0];
    if (!link) throw new HttpError(404, "Meeting link not found.");

    const input = (await readJson(request)) as Record<string, unknown>;
    const publicContext = {
      organizationId: link.organization_id,
      userId: link.owner_user_id,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
      permissions: [],
      roleSlugs: [],
    };
    const booking = await tenantTransaction(link.organization_id, (client) =>
      bookMeeting(client, publicContext, link.meeting_link_id, input),
    );
    return ok({ booking }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
