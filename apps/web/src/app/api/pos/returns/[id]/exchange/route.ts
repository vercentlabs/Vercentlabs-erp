import { z } from "zod";

import { assertSameOriginOrMobile, completePosExchange } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const exchangeSchema = z.object({
  cartId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200),
  payments: z.array(z.object({ method: z.literal("cash"), amount: z.number().min(0) })).min(1),
  expectedVersion: z.number().int().optional(),
  expectedGrandTotal: z.string().optional(),
});

// completePosExchange requires the return to already be approved
// (pos.return.approve, decided by someone other than the requester) and
// requires pos.sale.create for the replacement sale -- gated here on
// pos.sale.create since that is the narrower of the two floors a caller
// must pass to even reach the domain function's own approved-status check.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = exchangeSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create", { mutation: true });
      return completePosExchange(client, posContext(session), { ...input, returnId: id });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
