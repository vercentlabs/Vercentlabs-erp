import {
  saveMarketingSurvey,
  submitMarketingSurveyResponse,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmMarketingErrorResponse } from "@/lib/crm-marketing-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCampaignsManage);
    const context = crmContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (input.action !== "respond")
          return saveMarketingSurvey(client, context, input);
        const survey = (
          await client.query(
            "SELECT * FROM tenant.crm_marketing_surveys WHERE organization_id=$1 AND id=$2",
            [context.organizationId, String(input.surveyId || "")],
          )
        ).rows[0];
        if (!survey) throw new HttpError(404, "Survey not found.");
        return submitMarketingSurveyResponse(client, context, survey, input);
      },
    );
    return ok({ result }, 201);
  } catch (error) {
    return crmMarketingErrorResponse(error);
  }
}
