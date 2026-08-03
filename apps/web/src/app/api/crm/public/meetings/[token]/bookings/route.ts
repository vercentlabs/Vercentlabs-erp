import { bookMeeting } from "@vercentlabs/api";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { query, tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { clientIp } from "@/lib/security";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(
  request: Request,
  route: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await route.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) {
      throw new HttpError(404, "Meeting link not found.");
    }
    const fingerprint = `${token}:${clientIp(request)}`;
    const current = attempts.get(fingerprint);
    if (current && current.resetAt > Date.now() && current.count >= 20) {
      throw new HttpError(429, "Too many booking attempts. Try again later.");
    }
    attempts.set(fingerprint, {
      count: current && current.resetAt > Date.now() ? current.count + 1 : 1,
      resetAt:
        current && current.resetAt > Date.now()
          ? current.resetAt
          : Date.now() + 3600000,
    });
    const rows = await query<{
      organization_id: string;
      meeting_link_id: string;
      owner_user_id: string;
    }>("SELECT * FROM tenant.crm_public_meeting_link($1)", [token]);
    const link = rows[0];
    if (!link) throw new HttpError(404, "Meeting link not found.");
    const input = (await request.json()) as Record<string, unknown>;
    const context = {
      organizationId: link.organization_id,
      userId: link.owner_user_id,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    };
    const booking = await tenantTransaction(link.organization_id, (client) =>
      bookMeeting(client, context, link.meeting_link_id, input),
    );
    return ok({ booking }, 201);
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
