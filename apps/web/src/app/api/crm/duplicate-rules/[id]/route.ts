import { setDuplicateRuleEnabled } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    const { id } = await route.params;
    const body = (await readJson(request)) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      throw new HttpError(400, "Provide enabled: true/false.");
    }
    const context = await crmApiContext(session);
    const rule = await tenantTransaction(context.organizationId, async (client) => {
      const result = await setDuplicateRuleEnabled(client, context, id, body.enabled!);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.duplicate_rules.toggled",
        entityType: "duplicate_rule",
        entityId: id,
        afterData: { enabled: body.enabled },
        request,
        client,
      });
      return result;
    });
    return ok({ message: "Duplicate rule updated.", rule });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
