import { archiveCrmRecord, getCrmRecord, isCrmResource, requireBillingWriteAccess, updateCrmRecord } from "@vercentlabs/api";

import { HttpError, ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { assertCrmResourceMutationPermission, crmContext } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ resource: string; id: string }> };

// Governed generic CRM record boundary: read under CRM module access;
// changes need the resource's own manage permission (fail closed), then an
// active subscription; optimistic concurrency via expectedUpdatedAt.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", action: "crm.resource.get" }, async ({ client, session }) => {
    const { resource, id } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    return ok({ record: await getCrmRecord(client, crmContext(session), resource, id) });
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", action: "crm.resource.update" }, async ({ client, session }) => {
    const { resource, id } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    assertCrmResourceMutationPermission(session, resource);
    await requireBillingWriteAccess(client, session.organizationId, process.env);
    const body = (await readJson(request)) as { input?: Record<string, unknown>; expectedUpdatedAt?: string };
    const record = await updateCrmRecord(client, crmContext(session), resource, id, body.input ?? {}, { expectedUpdatedAt: body.expectedUpdatedAt, requireVersion: true });
    return ok({ record });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", action: "crm.resource.archive" }, async ({ client, session }) => {
    const { resource, id } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    assertCrmResourceMutationPermission(session, resource);
    await requireBillingWriteAccess(client, session.organizationId, process.env);
    const expectedUpdatedAt = new URL(request.url).searchParams.get("expectedUpdatedAt") ?? undefined;
    return ok({ record: await archiveCrmRecord(client, crmContext(session), resource, id, { expectedUpdatedAt, requireVersion: true }) });
  });
}
