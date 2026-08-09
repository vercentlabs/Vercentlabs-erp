import {
  awardGamificationPoints,
  createCoachingScorecard,
  getCrmPartnerEngagementReadiness,
  getPartnerEngagementDashboard,
  processInboundEmail,
  recordFieldVisit,
  registerPartnerDeal,
  saveSequenceBranch,
  submitMdfRequest,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
import { crmPartnerEngagementErrorResponse } from "@/lib/crm-partner-engagement-route";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    return ok(
      await tenantTransaction(context.organizationId, async (client) => ({
        dashboard: await getPartnerEngagementDashboard(client, context),
        readiness: await getCrmPartnerEngagementReadiness(client, context),
      })),
    );
  } catch (error) {
    return crmPartnerEngagementErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "");
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (action === "register-partner-deal")
          return registerPartnerDeal(client, context, input);
        if (action === "submit-mdf")
          return submitMdfRequest(client, context, input);
        if (action === "record-field-visit")
          return recordFieldVisit(client, context, input);
        if (action === "save-sequence-branch")
          return saveSequenceBranch(client, context, input);
        if (action === "create-scorecard")
          return createCoachingScorecard(client, context, input);
        if (action === "award-points")
          return awardGamificationPoints(client, context, input);
        if (action === "process-inbound-email")
          return processInboundEmail(client, context, input);
        throw new HttpError(400, "Unsupported partner-engagement action.");
      },
    );
    return ok(result);
  } catch (error) {
    return crmPartnerEngagementErrorResponse(error);
  }
}
