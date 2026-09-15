import { assertSameOriginOrMobile, assignLeadOwner } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as {
      ownerUserId?: string | null;
      reason?: string;
      expectedUpdatedAt?: string;
      override?: boolean;
      overrideReason?: string;
    };
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return assignLeadOwner(client, crmContext(session), id, body.ownerUserId ?? null, {
        reason: body.reason,
        expectedUpdatedAt: body.expectedUpdatedAt,
        requireVersion: true,
        override: body.override,
        overrideReason: body.overrideReason,
      });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
