import { getCrmMarketingReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmMarketingErrorResponse } from "@/lib/crm-marketing-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = crmContext(session);
    const sha = new URL(request.url).searchParams.get("commit");
    const readiness = await tenantTransaction(
      context.organizationId,
      (client) => getCrmMarketingReadiness(client, context, sha),
    );
    return ok({ readiness });
  } catch (error) {
    return crmMarketingErrorResponse(error);
  }
}
