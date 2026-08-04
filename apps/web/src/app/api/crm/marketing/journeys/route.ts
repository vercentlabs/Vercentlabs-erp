import {
  advanceMarketingJourney,
  enrollMarketingJourney,
  saveMarketingJourney,
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
    requirePermissionFromSession(session, PERMISSIONS.crmAutomationManage);
    const context = crmContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const result = await tenantTransaction(context.organizationId, (client) => {
      if (input.action === "enroll")
        return enrollMarketingJourney(client, context, input);
      if (input.action === "advance")
        return advanceMarketingJourney(
          client,
          context,
          String(input.enrollmentId || ""),
          input,
        );
      return saveMarketingJourney(client, context, input);
    });
    return ok({ result }, 201);
  } catch (error) {
    return crmMarketingErrorResponse(error);
  }
}
