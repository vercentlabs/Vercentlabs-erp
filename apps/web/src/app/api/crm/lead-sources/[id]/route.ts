import { assertSameOriginOrMobile, updateCrmLeadSource } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as { input?: Record<string, unknown>; expectedUpdatedAt?: string };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return updateCrmLeadSource(client, crmContext(session), id, body.input ?? {}, {
        expectedUpdatedAt: body.expectedUpdatedAt,
        requireVersion: true,
      });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
