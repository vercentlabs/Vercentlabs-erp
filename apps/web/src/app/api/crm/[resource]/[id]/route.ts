import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { archiveCrmRecord, getCrmRecord, updateCrmRecord } from "@vercent/api";
import { getSessionContext } from "@/lib/auth";
import {
  assertCrmIdentifier,
  requireCrmManage,
  requireCrmResourceView,
} from "@/lib/crm-api";
import {
  crmContext,
  crmDefinitions,
  isCrmDefinition,
  rethrowCrmError,
} from "@/lib/crm";
import { crmSchemas } from "@/lib/crm-validation";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function GET(
  _request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource, id } = await route.params;
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    assertCrmIdentifier(id);
    requireCrmResourceView(session, resource);
    const context = crmContext(session);
    const record = await tenantTransaction(context.organizationId, (client) =>
      getCrmRecord(client, context, resource, id),
    );
    return ok({ record });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
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
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    assertCrmIdentifier(id);
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const input = await crmSchemas[resource].parseAsync(
      await readJson(request),
    );
    const context = crmContext(session);
    const record = await tenantTransaction(context.organizationId, (client) =>
      updateCrmRecord(client, context, resource, id, input),
    );
    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `crm.${resource}.updated`,
      entityType: resource,
      entityId: id,
      afterData: input,
      request,
    });
    return ok({
      message: `${crmDefinitions[resource].singular.replace(/^./, (c) => c.toUpperCase())} updated.`,
      record,
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
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
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    assertCrmIdentifier(id);
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = crmContext(session);
    const record = await tenantTransaction(context.organizationId, (client) =>
      archiveCrmRecord(client, context, resource, id),
    );
    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `crm.${resource}.archived`,
      entityType: resource,
      entityId: id,
      afterData: record,
      request,
    });
    return ok({
      message: `${crmDefinitions[resource].singular.replace(/^./, (c) => c.toUpperCase())} archived.`,
      record,
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
