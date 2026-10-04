import { reorderCloseReasons } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// Body: { outcome: "won" | "lost", reasonIds: [...] }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManageCloseReasons, billingWrite: true }, async ({ client, session }) => {
    const body = await readBody(request);
    return ok({ reasons: await reorderCloseReasons(client, crmContext(session), { outcome: body.outcome as "won" | "lost", reasonIds: Array.isArray(body.reasonIds) ? body.reasonIds.map(String) : [] }) });
  });
}
