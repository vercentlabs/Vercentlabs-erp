import { assertSameOriginOrMobile, removeContactAccountRelationship, updateContactAccountRelationship } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string; relationshipId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, relationshipId } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.accountsManage);
      return updateContactAccountRelationship(client, crmContext(session), id, relationshipId, input);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, relationshipId } = await context.params;
    const url = new URL(request.url);
    const promoteRelationshipId = url.searchParams.get("promoteRelationshipId") ?? undefined;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.accountsManage);
      return removeContactAccountRelationship(client, crmContext(session), id, relationshipId, { promoteRelationshipId });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
