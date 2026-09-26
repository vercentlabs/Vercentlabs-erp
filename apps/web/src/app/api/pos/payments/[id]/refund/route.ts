import { z } from "zod";

import { refundPosPayment } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// Always routes back to the original captured payment's own provider
// reference and tender method (there is no "refund method" input here) and
// can never exceed the captured amount -- refundPosPayment enforces both.
const refundSchema = z.object({
  amount: z.number().positive(),
  idempotencyKey: z.string().trim().min(1).max(200),
  outcome: z.string().trim().max(64).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.payment.refund", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = refundSchema.parse(await readJson(request));
    const result = await refundPosPayment(client, posContext(session), { ...input, paymentId: id });
    return ok({ payment: result });
  });
}
