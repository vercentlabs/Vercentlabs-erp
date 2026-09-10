import {
  getLeadIntelligenceDashboard,
  refreshLeadNurtureQueue,
  updateLeadNurtureItem,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadIntelligenceErrorResponse } from "@/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getLeadIntelligenceDashboard(client, context),
    );
    return ok({ items: dashboard.topQueue || [] });
  } catch (error) {
    return crmLeadIntelligenceErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const context = await crmApiContext(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "refresh"
        ? refreshLeadNurtureQueue(client, context)
        : updateLeadNurtureItem(
            client,
            context,
            String(input.itemId || ""),
            input,
          ),
    );
    return ok({ result });
  } catch (error) {
    return crmLeadIntelligenceErrorResponse(error);
  }
}
