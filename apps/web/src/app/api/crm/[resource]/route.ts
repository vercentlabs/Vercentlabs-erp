import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { createCrmRecord, listCrmRecords } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmManage, requireCrmResourceView } from "@/modules/crm/api";
import {
  crmApiContext,
  crmDefinitions,
  crmErrorResponse,
  isCrmDefinition,
} from "@/modules/crm";
import { isCrmApiResource } from "@/modules/crm/scope";
import { crmSchemas } from "@/modules/crm/validation";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function GET(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource } = await route.params;
    if (!isCrmDefinition(resource) || !isCrmApiResource(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    requireCrmResourceView(session, resource);
    const url = new URL(request.url);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmRecords(
        client,
        context,
        resource,
        Object.fromEntries(url.searchParams.entries()),
      ),
    );
    return ok(result);
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource } = await route.params;
    if (!isCrmDefinition(resource) || !isCrmApiResource(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    const input = await crmSchemas[resource].parseAsync(
      await readJson(request),
    );
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const created = await createCrmRecord(
          client,
          context,
          resource,
          input,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.${resource}.created`,
          entityType: resource,
          entityId: String(created.id),
          afterData: input,
          request,
          client,
        });
        return created;
      },
    );
    return ok(
      {
        message: `${crmDefinitions[resource].singular.replace(/^./, (c) => c.toUpperCase())} created.`,
        record,
      },
      201,
    );
  } catch (error) {
    return crmErrorResponse(error);
  }
}
