import { disqualifyLead } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Body: { reason, notes? }
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsDisqualify, billingWrite: true }, async ({ client, session }) =>
    ok(await disqualifyLead(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
