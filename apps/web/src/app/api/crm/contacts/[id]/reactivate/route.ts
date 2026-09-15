import { assertSameOriginOrMobile, reactivateCrmContact } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request).catch(() => ({}))) as { expectedUpdatedAt?: string };
    const record = await tenantTransaction(session.organizationId, (client) =>
      reactivateCrmContact(client, crmContext(session), id, { expectedUpdatedAt: body.expectedUpdatedAt, requireVersion: true }),
    );
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
