import { listDuplicateRules, upsertDuplicateRule } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    const entityType = new URL(request.url).searchParams.get("entityType") || null;
    const context = await crmApiContext(session);
    const rules = await tenantTransaction(context.organizationId, (client) =>
      listDuplicateRules(client, context, entityType),
    );
    return ok({ rules });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    const body = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const rule = await tenantTransaction(context.organizationId, async (client) => {
      const result = await upsertDuplicateRule(client, context, body);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.duplicate_rules.upserted",
        entityType: "duplicate_rule",
        entityId: String(result.id),
        afterData: result,
        request,
        client,
      });
      return result;
    });
    return ok({ message: "Duplicate rule saved.", rule });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
