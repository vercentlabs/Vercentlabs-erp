import { z } from "zod";

import { flagPosCashTenderForReconciliation, resolvePosCashReconciliation } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// { action: "flag", note }: the cashier cannot settle what happened to cash in hand, so a supervisor will.
// { action: "resolve", resolution: "complete" | "return", note }: the supervisor finalises the sale with it or records the cash going back.
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("flag"), note: z.string().trim().min(1).max(500) }),
  z.object({
    action: z.literal("resolve"),
    resolution: z.enum(["complete", "return"]),
    note: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().min(8).max(100).optional(),
  }),
]);

export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({
    cash: input.action === "flag"
      ? await flagPosCashTenderForReconciliation(client, context, checkoutId, input)
      : await resolvePosCashReconciliation(client, context, checkoutId, input),
  }), 200, "pos.sale.create");
}
