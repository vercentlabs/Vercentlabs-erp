import {
  removeContactAccountRelationship,
  updateContactAccountRelationship,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string; relationshipId: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    const { id, relationshipId } = await route.params;
    const body = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const relationships = await tenantTransaction(context.organizationId, async (client) => {
      const result = await updateContactAccountRelationship(client, context, id, relationshipId, body);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.contact_relationships.updated",
        entityType: "contact",
        entityId: id,
        afterData: { relationshipId, ...body },
        request,
        client,
      });
      return result;
    });
    return ok({ message: "Relationship updated.", relationships });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  route: { params: Promise<{ id: string; relationshipId: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    const { id, relationshipId } = await route.params;
    const body = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const relationships = await tenantTransaction(context.organizationId, async (client) => {
      const result = await removeContactAccountRelationship(client, context, id, relationshipId, {
        promoteRelationshipId: body.promoteRelationshipId ? String(body.promoteRelationshipId) : undefined,
      });
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.contact_relationships.removed",
        entityType: "contact",
        entityId: id,
        afterData: { relationshipId },
        request,
        client,
      });
      return result;
    });
    return ok({ message: "Relationship removed.", relationships });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
