import { listLeadAssignmentHistory } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Every change of owner or team, newest first. The operation loads the lead
// first, which enforces visibility.
export async function GET(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) =>
    ok({ history: await listLeadAssignmentHistory(client, crmContext(session), (await route.params).id) }),
  );
}
