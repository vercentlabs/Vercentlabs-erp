import { convertLead, previewLeadConversion } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// What the Convert dialog shows: the lead summary, the conversion checks,
// matching accounts and contacts, open deals and suggested values.
// ?accountId: the account chosen in the dialog, so its contacts and deals are matched.
export async function GET(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsConvert }, async ({ client, session }) => {
    const accountId = new URL(request.url).searchParams.get("accountId");
    return ok({ preview: await previewLeadConversion(client, crmContext(session), (await route.params).id, { accountId }) });
  });
}

// Lead → account + contact + opportunity in this request's one transaction:
// any failure rolls the whole conversion back. A retry with the same
// idempotencyKey returns the first result.
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsConvert, billingWrite: true }, async ({ client, session }) =>
    ok({ conversion: await convertLead(client, crmContext(session), (await route.params).id, await readBody(request)) }),
  );
}
