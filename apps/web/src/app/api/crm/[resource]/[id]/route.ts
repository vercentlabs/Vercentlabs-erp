import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { archiveCrmRecord, getCrmRecord, updateCrmRecord } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import {
  assertCrmIdentifier,
  requireCrmManage,
  requireCrmResourceView,
} from "@/modules/crm/api";
import {
  crmApiContext,
  crmDefinitions,
  crmErrorResponse,
  isCrmDefinition,
} from "@/modules/crm";
import { isCrmApiResource } from "@/modules/crm/scope";
import { crmPatchSchemas } from "@/modules/crm/validation";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function GET(
  _request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource, id } = await route.params;
    if (!isCrmDefinition(resource) || !isCrmApiResource(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    assertCrmIdentifier(id);
    requireCrmResourceView(session, resource);
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, (client) =>
      getCrmRecord(client, context, resource, id),
    );
    return ok({ record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
export async function PATCH(
  request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource, id } = await route.params;
    if (!isCrmDefinition(resource) || !isCrmApiResource(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    assertCrmIdentifier(id);
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    const input = await crmPatchSchemas[resource].parseAsync(
      await readJson(request),
    );
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const updated = await updateCrmRecord(
          client,
          context,
          resource,
          id,
          input,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.${resource}.updated`,
          entityType: resource,
          entityId: id,
          afterData: input,
          request,
          client,
        });
        return updated;
      },
    );
    return ok({
      message: `${crmDefinitions[resource].singular.replace(/^./, (c) => c.toUpperCase())} updated.`,
      record,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
export async function DELETE(
  request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource, id } = await route.params;
    if (!isCrmDefinition(resource) || !isCrmApiResource(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    assertCrmIdentifier(id);
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const archived = await archiveCrmRecord(
          client,
          context,
          resource,
          id,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.${resource}.archived`,
          entityType: resource,
          entityId: id,
          afterData: archived,
          request,
          client,
        });
        return archived;
      },
    );
    return ok({
      message: `${crmDefinitions[resource].singular.replace(/^./, (c) => c.toUpperCase())} archived.`,
      record,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
