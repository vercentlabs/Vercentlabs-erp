import {
  getLeadScoreExplanation,
  recalculateLeadScore,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadIntelligenceErrorResponse } from "@/modules/crm/server/lead-intelligence";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
type Params = { params: Promise<{ leadId: string }> };
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const context = await crmApiContext(session);
    const { leadId } = await params;
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        getLeadScoreExplanation(client, context, leadId),
      ),
    );
  } catch (error) {
    return crmLeadIntelligenceErrorResponse(error);
  }
}
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const context = await crmApiContext(session);
    const { leadId } = await params;
    const input = (await readJson(request)) as Record<string, unknown>;
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        recalculateLeadScore(
          client,
          context,
          leadId,
          String(input.reason || "Manual recalculation"),
        ),
      ),
    );
  } catch (error) {
    return crmLeadIntelligenceErrorResponse(error);
  }
}
