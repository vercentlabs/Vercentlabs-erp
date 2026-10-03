import { saveLeadQualification } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Saves the qualification answers without changing the lead's status.
export async function PUT(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsEdit, billingWrite: true }, async ({ client, session }) =>
    ok(await saveLeadQualification(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
