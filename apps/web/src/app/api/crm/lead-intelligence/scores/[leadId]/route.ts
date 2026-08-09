import {
  getLeadScoreExplanation,
  recalculateLeadScore,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmLeadIntelligenceErrorResponse } from "@/lib/crm-lead-intelligence-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
type Params = { params: Promise<{ leadId: string }> };
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
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
