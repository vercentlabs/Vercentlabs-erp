import { assignLead } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Body: { ownerUserId?, teamId? } — null clears. Moving an existing owner needs
// crm.leads.reassign, which the operation checks.
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsAssign, billingWrite: true }, async ({ client, session }) =>
    ok(await assignLead(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
