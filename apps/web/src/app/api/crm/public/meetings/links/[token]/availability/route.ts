import { getMeetingAvailability } from "@vercentlabs/api";

import { query, tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

type RouteContext = { params: Promise<{ token: string }> };

// F014 Stage A2 §5. Resolves the same tenant.crm_public_meeting_link(token)
// row the sibling info route does, then delegates slot computation to the
// exact same getMeetingAvailability an authenticated caller would use — no
// second slot-computation engine for the public path.
export async function GET(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) throw new HttpError(404, "Meeting link not found.");
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "A valid date is required.");

    const rows = await query<{ organization_id: string; meeting_link_id: string; owner_user_id: string }>(
      "SELECT organization_id,meeting_link_id,owner_user_id FROM tenant.crm_public_meeting_link($1)",
      [token],
    );
    const link = rows[0];
    if (!link) throw new HttpError(404, "Meeting link not found.");

    const publicContext = {
      organizationId: link.organization_id,
      userId: link.owner_user_id,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
      permissions: [],
      roleSlugs: [],
    };
    const slots = await tenantTransaction(link.organization_id, (client) =>
      getMeetingAvailability(client, publicContext, link.meeting_link_id, date),
    );
    return ok({ slots });
  } catch (error) {
    return errorResponse(error);
  }
}
