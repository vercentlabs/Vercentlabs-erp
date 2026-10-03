import { mergeLeads } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Merges this lead (the duplicate) into body.keepLeadId (targetLeadId is accepted too).
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsEdit, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { keepLeadId, targetLeadId } = await readBody(request);
    return ok(await mergeLeads(client, context, (await route.params).id, String(keepLeadId ?? targetLeadId ?? "")));
  });
}
