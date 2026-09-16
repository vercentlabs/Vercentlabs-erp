import { archiveCrmNote, assertSameOriginOrMobile, getCrmNote, updateCrmNote } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const note = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmNote(client, crmContext(session), id);
    });
    return ok({ note });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const note = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return updateCrmNote(client, crmContext(session), id, input);
    });
    return ok({ note });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const url = new URL(request.url);
    const expectedVersion = url.searchParams.get("expectedVersion");
    const note = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return archiveCrmNote(client, crmContext(session), id, { expectedVersion: expectedVersion ? Number(expectedVersion) : undefined });
    });
    return ok({ note });
  } catch (error) {
    return errorResponse(error);
  }
}
