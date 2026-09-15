import { assertSameOriginOrMobile, getCrmTask, updateCrmTask } from "@vercentlabs/api";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const record = await withClient((client) => getCrmTask(client, crmContext(session), id));
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
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, (client) => updateCrmTask(client, crmContext(session), id, input));
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
