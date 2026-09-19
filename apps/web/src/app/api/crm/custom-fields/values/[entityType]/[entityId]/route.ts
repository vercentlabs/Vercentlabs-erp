import { assertSameOriginOrMobile, getCustomFieldValues, setCustomFieldValues } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Module-access-only, matching Notes/Attachments' own model — the real
// authorization is resolveCrmEntityAccess (parent-record access), called
// inside getCustomFieldValues/setCustomFieldValues themselves, not a
// blanket organizational "manage" permission.
export async function GET(_request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { entityType, entityId } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCustomFieldValues(client, crmContext(session), entityType as never, entityId);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { entityType, entityId } = await context.params;
    const body = (await readJson(request)) as { values?: Record<string, unknown> };
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, undefined, { mutation: true });
      return setCustomFieldValues(client, crmContext(session), entityType as never, entityId, body.values ?? {});
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
