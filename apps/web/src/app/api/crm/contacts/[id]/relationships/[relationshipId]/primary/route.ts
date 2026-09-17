import { assertSameOriginOrMobile, setPrimaryContactAccountRelationship } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string; relationshipId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, relationshipId } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.accountsManage);
      return setPrimaryContactAccountRelationship(client, crmContext(session), id, relationshipId);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
