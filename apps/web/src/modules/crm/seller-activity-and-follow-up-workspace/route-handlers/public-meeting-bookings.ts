// Capability-owned CRM route implementation. The Next.js route file is a thin adapter only.
import { bookMeeting } from "@vercentlabs/api";
import { crmCommunicationsErrorResponse } from "@/modules/crm/seller-activity-and-follow-up-workspace/communications";
import { query, tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { clientIp, enforceRateLimit, readRequestBytes } from "@/core/security";

async function readJsonObject(request: Request, maximumBytes: number) {
  const bytes = await readRequestBytes(request, maximumBytes);
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Invalid JSON request.");
  }
  return parsed as Record<string, unknown>;
}


export async function POST(
  request: Request,
  route: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await route.params;
    if (!/^[0-9a-f]{36}$/i.test(token)) {
      throw new HttpError(404, "Meeting link not found.");
    }
    // Distributed limiter: survives process/container/serverless boundaries.
    // The IP-only guard prevents random-token attacks from creating an unbounded
    // rate-limit key per guessed token before the token is resolved.
    await enforceRateLimit(`crm:public-meeting:ip:${clientIp(request)}`, 120, 3600);
    const rows = await query<{
      organization_id: string;
      meeting_link_id: string;
      owner_user_id: string;
    }>("SELECT * FROM tenant.crm_public_meeting_link($1)", [token]);
    const link = rows[0];
    if (!link) throw new HttpError(404, "Meeting link not found.");
    await enforceRateLimit(`crm:public-meeting:${token}:${clientIp(request)}`, 20, 3600);
    const input = await readJsonObject(request, 50_000);
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
