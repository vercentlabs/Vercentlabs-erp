import { archiveCrmNote, getCrmNote, updateCrmNote } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const note = await getCrmNote(client, crmContext(session), id);
    return ok({ note });
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const note = await updateCrmNote(client, crmContext(session), id, input);
    return ok({ note });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const expectedVersion = url.searchParams.get("expectedVersion");
    const note = await archiveCrmNote(client, crmContext(session), id, { expectedVersion: expectedVersion ? Number(expectedVersion) : undefined });
    return ok({ note });
  });
}
