import { openLeadSlaCase, recordLeadResponse, scanLeadSlaBreaches, requireSessionPermission } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// app/api/crm/lead-intelligence/sla/route.ts — the underlying
// openLeadSlaCase/recordLeadResponse/scanLeadSlaBreaches functions already
// exist live in @vercentlabs/api.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    requireSessionPermission(session, CRM_PERMISSIONS.leadsManage);
    requireSessionPermission(session, CRM_PERMISSIONS.leadsViewSensitive);
    const input = (await readJson(request)) as Record<string, unknown>;
    if (input.action === "scan") requireSessionPermission(session, CRM_PERMISSIONS.recordsViewAll);
    const context = crmContext(session);
    const result = await (input.action === "open"
      ? openLeadSlaCase(client, context, String(input.leadId || ""), input)
      : input.action === "respond"
        ? recordLeadResponse(client, context, String(input.leadId || ""), input)
        : input.action === "scan"
          ? scanLeadSlaBreaches(client, context, input.now ? new Date(String(input.now)) : new Date())
          : Promise.reject(new HttpError(400, "Unsupported SLA action.")));
    return ok({ result });
  });
}
