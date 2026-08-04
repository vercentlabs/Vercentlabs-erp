import {
  captureDealRisk,
  captureRelationshipIntelligence,
  createAssistantDraft,
  createNextBestAction,
  getCrmAiDashboard,
  getCrmAiReadiness,
  recordAiFeedback,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
import { crmAiIntelligenceErrorResponse } from "@/lib/crm-ai-intelligence-route";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const c = crmContext(session);
    return ok(
      await tenantTransaction(c.organizationId, async (client) => ({
        dashboard: await getCrmAiDashboard(client, c),
        readiness: await getCrmAiReadiness(client, c),
      })),
    );
  } catch (e) {
    return crmAiIntelligenceErrorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    const input = (await readJson(request)) as Record<string, unknown>;
    const a = String(input.action || "");
    const c = crmContext(session);
    const r = await tenantTransaction(c.organizationId, (client) => {
      if (a === "next-best-action")
        return createNextBestAction(client, c, input);
      if (a === "relationship")
        return captureRelationshipIntelligence(client, c, input);
      if (a === "draft") return createAssistantDraft(client, c, input);
      if (a === "deal-risk") return captureDealRisk(client, c, input);
      if (a === "feedback") return recordAiFeedback(client, c, input);
      throw new HttpError(400, "Unsupported CRM AI action.");
    });
    return ok(r);
  } catch (e) {
    return crmAiIntelligenceErrorResponse(e);
  }
}
