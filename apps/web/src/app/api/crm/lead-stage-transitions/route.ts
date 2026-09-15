import { addLeadStageTransition, assertSameOriginOrMobile, listLeadStageTransitions } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function GET() {
  try {
    const session = await requireWorkspace();
    const rows = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return listLeadStageTransitions(client, crmContext(session));
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
    const body = (await readJson(request)) as { fromStageId?: string; toStageId?: string; reasonRequired?: boolean };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return addLeadStageTransition(client, crmContext(session), body.fromStageId ?? "", body.toStageId ?? "", { reasonRequired: body.reasonRequired });
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
