import { z } from "zod";

import { assertSameOriginOrMobile, refundPosPayment } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// Always routes back to the original captured payment's own provider
// reference and tender method (there is no "refund method" input here) and
// can never exceed the captured amount -- refundPosPayment enforces both.
const refundSchema = z.object({
  amount: z.number().positive(),
  idempotencyKey: z.string().trim().min(1).max(200),
  outcome: z.string().trim().max(64).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = refundSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.payment.refund");
      return refundPosPayment(client, posContext(session), { ...input, paymentId: id });
    });
    return ok({ payment: result });
  } catch (error) {
    return errorResponse(error);
  }
}
