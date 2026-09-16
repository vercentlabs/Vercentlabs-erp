import { archiveCrmAccount, assertSameOriginOrMobile, getCrmAccountForCaller, updateCrmAccount } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmAccountForCaller(client, crmContext(session), id);
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
    const { id } = await context.params;
    const body = (await readJson(request)) as { input?: Record<string, unknown>; expectedUpdatedAt?: string };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.accountsManage);
      return updateCrmAccount(client, crmContext(session), id, body.input ?? {}, { expectedUpdatedAt: body.expectedUpdatedAt, requireVersion: true });
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
    const { id } = await context.params;
    const url = new URL(request.url);
    const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt") ?? undefined;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.accountsManage);
      return archiveCrmAccount(client, crmContext(session), id, { expectedUpdatedAt, requireVersion: true });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
