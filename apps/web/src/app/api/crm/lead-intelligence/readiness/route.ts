import { getCrmLeadIntelligenceReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmLeadIntelligenceErrorResponse } from "@/lib/crm-lead-intelligence-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const commitSha = new URL(request.url).searchParams.get("commitSha");
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        getCrmLeadIntelligenceReadiness(client, context, commitSha),
      ),
    );
  } catch (error) {
    return crmLeadIntelligenceErrorResponse(error);
  }
}
