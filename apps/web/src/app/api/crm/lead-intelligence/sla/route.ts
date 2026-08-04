import {
  openLeadSlaCase,
  recordLeadResponse,
  scanLeadSlaBreaches,
} from "@vercentlabs/api";
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
