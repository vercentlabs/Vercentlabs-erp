import { assertSameOriginOrMobile, postPosDayEndReportToAccounting } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.accounting.post");
      return postPosDayEndReportToAccounting(client, posContext(session), id);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
