import { listLeadStageHistory } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Each stage the lead has been in, newest first. The operation loads the lead
// first, which enforces visibility.
export async function GET(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) =>
    ok({ history: await listLeadStageHistory(client, crmContext(session), (await route.params).id) }),
  );
}
