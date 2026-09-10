import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { mergeCrmLead } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { mergeLeadSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
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
    const context = await crmApiContext(session);
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
