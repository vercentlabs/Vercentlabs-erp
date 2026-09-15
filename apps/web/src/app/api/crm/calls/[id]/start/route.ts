import { assertSameOriginOrMobile, startCrmCall } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, (client) => startCrmCall(client, crmContext(session), id, input));
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
