import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { mergeCrmLead } from "@vercent/api";
import { getSessionContext } from "@/lib/auth";
import { assertCrmIdentifier } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { mergeLeadSchema } from "@/lib/crm-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOriginOrMobile, audit } from "@/lib/security";
export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const { targetLeadId } = mergeLeadSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = crmContext(session);
    const merge = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const merged = await mergeCrmLead(
          client,
          context,
          id,
          targetLeadId,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.lead.merged",
          entityType: "lead",
          entityId: targetLeadId,
          afterData: merged,
          request,
          client,
        });
        return merged;
      },
    );
    return ok({ message: "Duplicate lead merged.", merge });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
