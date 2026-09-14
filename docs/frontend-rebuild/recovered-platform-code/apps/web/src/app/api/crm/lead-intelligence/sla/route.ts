import {
  openLeadSlaCase,
  recordLeadResponse,
  scanLeadSlaBreaches,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadIntelligenceErrorResponse } from "@/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const context = await crmApiContext(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    if (input.action === "scan")
      requirePermissionFromSession(session, PERMISSIONS.crmRecordsViewAll);
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "open"
        ? openLeadSlaCase(client, context, String(input.leadId || ""), input)
        : input.action === "respond"
          ? recordLeadResponse(
              client,
              context,
              String(input.leadId || ""),
              input,
            )
          : input.action === "scan"
            ? scanLeadSlaBreaches(
                client,
                context,
                input.now ? new Date(String(input.now)) : new Date(),
              )
            : Promise.reject(new HttpError(400, "Unsupported SLA action.")),
    );
    return ok({ result });
  } catch (error) {
    return crmLeadIntelligenceErrorResponse(error);
  }
}
