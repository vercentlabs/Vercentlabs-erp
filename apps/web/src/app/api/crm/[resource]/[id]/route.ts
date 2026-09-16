import { archiveCrmRecord, assertSameOriginOrMobile, getCrmRecord, isCrmResource, updateCrmRecord } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";
import { RESOURCE_MANAGE_PERMISSIONS } from "@/features/crm/shared/resource-permissions";

type RouteContext = { params: Promise<{ resource: string; id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { resource, id } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmRecord(client, crmContext(session), resource, id);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { resource, id } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    const body = (await readJson(request)) as { input?: Record<string, unknown>; expectedUpdatedAt?: string };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, RESOURCE_MANAGE_PERMISSIONS[resource]);
      return updateCrmRecord(client, crmContext(session), resource, id, body.input ?? {}, {
        expectedUpdatedAt: body.expectedUpdatedAt,
        requireVersion: true,
      });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { resource, id } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    const url = new URL(request.url);
    const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt") ?? undefined;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, RESOURCE_MANAGE_PERMISSIONS[resource]);
      return archiveCrmRecord(client, crmContext(session), resource, id, { expectedUpdatedAt, requireVersion: true });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
