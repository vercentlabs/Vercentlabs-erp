import {
  addContactAccountRelationship,
  listContactAccountRelationships,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params;
    const context = await crmApiContext(session);
    const relationships = await tenantTransaction(context.organizationId, (client) =>
      listContactAccountRelationships(client, context, id),
    );
    return ok({ relationships });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    const { id } = await route.params;
    const body = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const relationships = await tenantTransaction(context.organizationId, async (client) => {
      const result = await addContactAccountRelationship(client, context, id, body);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.contact_relationships.added",
        entityType: "contact",
        entityId: id,
        afterData: { accountId: body.accountId, stakeholderRole: body.stakeholderRole },
        request,
        client,
      });
      return result;
    });
    return ok({ message: "Relationship added.", relationships });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
