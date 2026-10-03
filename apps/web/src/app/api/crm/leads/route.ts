import { createLead, listLeads } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { leadFiltersFromUrl, readBody } from "@/features/crm/leads/server/lead-http";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) => {
    const context = crmContext(session);
    const { leads, ...page } = await listLeads(client, context, leadFiltersFromUrl(new URL(request.url)));
    return ok({ rows: leads, ...page });
  });
}

// Body: the lead fields, plus allowDuplicate: true to save despite a
// duplicate warning. A duplicate is refused with 409 and its matches.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsCreate, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { allowDuplicate, ...input } = await readBody(request);
    return ok({ record: await createLead(client, context, input, { allowDuplicate: allowDuplicate === true }) }, 201);
  });
}
