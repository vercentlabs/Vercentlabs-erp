import { assertSameOriginOrMobile, rollbackLeadImport } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Only a completed batch can be rolled back, and only the leads it
// created (matched via crm_lead_provenance) that have no activity
// recorded against them yet are deleted — rollbackLeadImport's own
// guard, not re-derived here.
export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { batchId } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.import, { mutation: true });
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      return rollbackLeadImport(client, crmContext(session), batchId);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
