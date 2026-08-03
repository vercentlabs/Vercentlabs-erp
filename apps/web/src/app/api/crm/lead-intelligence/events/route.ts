import { recordLeadBehaviorEvent } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmLeadIntelligenceErrorResponse } from "@/lib/crm-lead-intelligence-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    const context = crmContext(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    return ok(
      {
        result: await tenantTransaction(context.organizationId, (client) =>
          recordLeadBehaviorEvent(client, context, input),
        ),
      },
      201,
    );
  } catch (error) {
    return crmLeadIntelligenceErrorResponse(error);
  }
}
