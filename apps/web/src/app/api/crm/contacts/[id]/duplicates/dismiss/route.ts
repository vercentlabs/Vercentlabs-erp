import { dismissContactDuplicateMatch } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsManage);
    const { id } = await route.params;
    const body = (await readJson(request)) as { matchedIds?: string[]; reason?: string };
    const context = await crmApiContext(session);
    const dismissal = await tenantTransaction(context.organizationId, async (client) => {
      const result = await dismissContactDuplicateMatch(
        client,
        context,
        id,
        Array.isArray(body.matchedIds) ? body.matchedIds : [],
        body.reason || "",
      );
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.contact.duplicate_dismissed",
        entityType: "contact",
        entityId: id,
        afterData: { matchedIds: body.matchedIds, reason: body.reason },
        request,
        client,
      });
      return result;
    });
    return ok({ message: "Marked as not a duplicate.", dismissal });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
