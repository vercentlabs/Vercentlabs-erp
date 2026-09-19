import { assertSameOriginOrMobile, deactivateLeadStageWithMigration } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// Fails closed with CRM_LEAD_STAGE_HAS_ACTIVE_LEADS (+ affectedCount) if
// active Leads remain on the stage and no migrateToStageId was given —
// the UI must surface that count and let the operator choose a
// replacement stage rather than silently stranding those Leads.
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as { migrateToStageId?: string };
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage, { mutation: true });
      return deactivateLeadStageWithMigration(client, crmContext(session), id, { migrateToStageId: body.migrateToStageId });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
