import { assertSameOriginOrMobile, createLeadStageTransitionReason, listLeadStageTransitionReasons } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function GET() {
  try {
    const session = await requireWorkspace();
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listLeadStageTransitionReasons(client, crmContext(session));
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage, { mutation: true });
      return createLeadStageTransitionReason(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
