import { assertSameOriginOrMobile, mergeContactsGoverned } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as {
      sourceId?: string;
      survivorId?: string;
      reason?: string | null;
      fieldSelections?: Record<string, "source" | "survivor">;
      expectedSourceUpdatedAt?: string;
      expectedSurvivorUpdatedAt?: string;
    };
    if (!body.sourceId || !body.survivorId) throw new HttpError(400, "Both sourceId and survivorId are required.");
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.accountsManage, { mutation: true });
      return mergeContactsGoverned(client, crmContext(session), body.sourceId!, body.survivorId!, body.reason ?? null, {
        fieldSelections: body.fieldSelections,
        expectedSourceUpdatedAt: body.expectedSourceUpdatedAt,
        expectedSurvivorUpdatedAt: body.expectedSurvivorUpdatedAt,
      });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
