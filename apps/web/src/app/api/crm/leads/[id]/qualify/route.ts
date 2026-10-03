import { qualifyLead } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Qualifies the lead if its required criteria are met; otherwise 409 with the
// missing criteria. Body: optional answers saved with the decision, and
// { override: true, overrideReason } to qualify anyway, which needs
// crm.leads.override_qualification (checked by the operation).
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsQualify, billingWrite: true }, async ({ client, session }) =>
    ok(await qualifyLead(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
