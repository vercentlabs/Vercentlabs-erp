import { getLeadTimelinePage } from "@/modules/crm/server/lead-detail-data";
import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { id } = await params;
    assertCrmIdentifier(id);
    const url = new URL(request.url);
    const source = String(url.searchParams.get("source") || "activities");
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 50);
    if (source !== "activities" && source !== "communications")
      throw new HttpError(400, "Unsupported timeline source.", "CRM_LEAD_TIMELINE_SOURCE_INVALID");
    const context = await crmApiContext(session);
    const page = await tenantTransaction(context.organizationId, (client) =>
      getLeadTimelinePage(client, context, id, source, offset, limit),
    );
    return ok(page);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
