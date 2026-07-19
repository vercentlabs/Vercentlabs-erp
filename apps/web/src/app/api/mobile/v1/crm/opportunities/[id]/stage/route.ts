import { moveOpportunityStage } from "@vercent/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/lib/billing";
import { assertCrmIdentifier } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { moveStageSchema } from "@/lib/crm-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import { withMobileIdempotency } from "@/lib/mobile-idempotency";
import { audit } from "@/lib/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const { id } = await route.params; assertCrmIdentifier(id);
    const input = moveStageSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = crmContext(session);
    const response = await tenantTransaction(context.organizationId, async (client) => withMobileIdempotency(client, session, request, input, async () => {
      const record = await moveOpportunityStage(client, context, id, input.stageId, input.note);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.opportunity.stage_changed", entityType: "opportunity", entityId: id, afterData: record, request, client });
      return { message: "Opportunity stage updated.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
