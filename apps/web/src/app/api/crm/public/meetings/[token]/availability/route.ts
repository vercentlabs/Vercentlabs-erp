import { getMeetingAvailability } from "@vercentlabs/api";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { query, tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function GET(
  request: Request,
  route: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await route.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) {
      throw new HttpError(404, "Meeting link not found.");
    }
    const rows = await query<{
      organization_id: string;
      meeting_link_id: string;
      owner_user_id: string;
    }>("SELECT * FROM tenant.crm_public_meeting_link($1)", [token]);
    const link = rows[0];
    if (!link) throw new HttpError(404, "Meeting link not found.");
    const date = new URL(request.url).searchParams.get("date") || "";
    const context = {
      organizationId: link.organization_id,
      userId: link.owner_user_id,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    };
    const slots = await tenantTransaction(link.organization_id, (client) =>
      getMeetingAvailability(client, context, link.meeting_link_id, date),
    );
    const response = ok({ slots });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
