import { addOpportunityContactRole, assertSameOriginOrMobile, listOpportunityContactRoles } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F003 gap-closure — listOpportunityContactRoles/addOpportunityContactRole
// (opportunity-contacts.js) govern the new multi-Contact Opportunity role
// model (tenant.crm_opportunity_contact_roles, migration 165) — mirrors the
// Contact<->Account relationship route shape exactly.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listOpportunityContactRoles(client, crmContext(session), id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
      return addOpportunityContactRole(client, crmContext(session), id, input);
    });
    return ok({ rows }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
