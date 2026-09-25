import { assertSameOriginOrMobile, upsertStageSlaPolicy } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as {
      pipelineId: string;
      maximumDays?: number | string | null;
      status?: "active" | "inactive";
      expectedUpdatedAt?: string;
    };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage, { mutation: true });
      return upsertStageSlaPolicy(client, crmContext(session), { ...body, stageId: id });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
