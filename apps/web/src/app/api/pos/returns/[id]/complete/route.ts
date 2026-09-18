import { z } from "zod";

import { assertSameOriginOrMobile, completePointOfSaleReturn } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const completeReturnSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  // F292: only meaningful for a non-cash tender leg, and only ever honored
  // by the sandbox adapter (the same "outcome" knob initiatePosPayment/
  // refundPosPayment's own routes already expose) — a real provider
  // determines its own outcome from its live response, ignoring this.
  refundOutcome: z.string().trim().max(64).optional(),
});

// completePointOfSaleReturn itself requires pos.return.approve (the same
// permission that gates approving the return) — completing the refund is
// treated as part of the same supervisor-level action as approving it, not
// a separate cashier action.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = completeReturnSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.return.approve");
      return completePointOfSaleReturn(client, posContext(session), id, input);
    });
    return ok({ posReturn: result });
  } catch (error) {
    return errorResponse(error);
  }
}
