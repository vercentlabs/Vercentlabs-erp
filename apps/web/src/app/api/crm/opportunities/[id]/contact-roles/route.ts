import { addOpportunityContactRole, listOpportunityContactRoles } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F003 gap-closure — listOpportunityContactRoles/addOpportunityContactRole
// (opportunity-contacts.js) govern the new multi-Contact Opportunity role
// model (tenant.crm_opportunity_contact_roles, migration 165) — mirrors the
// Contact<->Account relationship route shape exactly.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listOpportunityContactRoles(client, crmContext(session), id);
    return ok({ rows });
  });
}

export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const rows = await addOpportunityContactRole(client, crmContext(session), id, input);
    return ok({ rows }, 201);
  });
}
