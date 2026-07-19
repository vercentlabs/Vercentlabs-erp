import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { createCrmRecord, listCrmRecords } from "@vercent/api";
import { getSessionContext } from "@/lib/auth";
import { requireCrmManage, requireCrmResourceView } from "@/lib/crm-api";
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
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource } = await route.params;
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    requireCrmResourceView(session, resource);
    const url = new URL(request.url);
    const context = crmContext(session);
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
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
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
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    const input = await crmSchemas[resource].parseAsync(
      await readJson(request),
    );
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = crmContext(session);
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
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
