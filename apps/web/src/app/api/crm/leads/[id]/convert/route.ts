import { convertLead, previewLeadConversion } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// What the conversion dialog shows: matching accounts and contacts, sales
// stages and suggested values.
export async function GET(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsConvert }, async ({ client, session }) =>
    ok({ preview: await previewLeadConversion(client, crmContext(session), (await route.params).id) }),
  );
}

// Lead → account + contact + opportunity in this request's one transaction:
// any failure rolls the whole conversion back.
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsConvert, billingWrite: true }, async ({ client, session }) =>
    ok({ conversion: await convertLead(client, crmContext(session), (await route.params).id, await readBody(request)) }),
  );
}
