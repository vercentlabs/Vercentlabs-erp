import { z } from "zod";

import { approvePointOfSaleReturn, assertSameOriginOrMobile } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const approveReturnSchema = z.object({
  reason: z.string().trim().max(1_000).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = approveReturnSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.return.approve");
      return approvePointOfSaleReturn(client, posContext(session), id, input);
    });
    return ok({ posReturn: result });
  } catch (error) {
    return errorResponse(error);
  }
}
