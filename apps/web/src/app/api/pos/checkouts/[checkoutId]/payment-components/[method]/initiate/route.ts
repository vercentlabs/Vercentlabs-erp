import { z } from "zod";

import { initiateSplitComponent } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string; method: string }> };

// Collect one planned part through its own handler — the card terminal (terminalId), the UPI QR, or cash (cashReceived) — for exactly its
// planned amount. One external attempt at a time; a confirmed method is never collected twice. `outcome` only scripts the sandbox.
const schema = z.object({
  terminalId: z.string().uuid().optional(),
  cashReceived: z.union([z.string().trim().max(30), z.number()]).optional(),
  changeGiven: z.union([z.string().trim().max(30), z.number()]).nullish(),
  idempotencyKey: z.string().min(8).max(100),
  outcome: z.string().trim().max(40).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { checkoutId, method } = await params;
  return posMutation(request, schema, async (client, context, input) => initiateSplitComponent(client, context, checkoutId, {
    ...input, method: method as "cash" | "card" | "upi",
    cashReceived: input.cashReceived === undefined ? undefined : String(input.cashReceived),
    changeGiven: input.changeGiven === undefined || input.changeGiven === null ? null : String(input.changeGiven),
  }), 200, "pos.sale.create");
}
