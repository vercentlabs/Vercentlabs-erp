import { moveOpportunityStage } from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { moveStageSchema } from "@/modules/crm/validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { audit } from "@/core/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const { id } = await route.params; assertCrmIdentifier(id);
    const input = moveStageSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, async (client) => withMobileIdempotency(client, session, request, input, async () => {
      const record = await moveOpportunityStage(client, context, id, input.stageId, input.note, { expectedUpdatedAt: input.expectedUpdatedAt, expectedStageId: input.expectedStageId });
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.opportunity.stage_changed", entityType: "opportunity", entityId: id, afterData: record, request, client });
      return { message: "Opportunity stage updated.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
