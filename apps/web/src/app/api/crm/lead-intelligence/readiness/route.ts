import { getCrmLeadIntelligenceReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadIntelligenceErrorResponse } from "@/modules/crm/server/lead-intelligence";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
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
