import { z } from "zod";

import { beginPosCheckout, releasePosCheckout, validatePosCartForCheckout } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: is the bill ready for payment, and if not, what to fix (nothing changes).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => validatePosCartForCheckout(client, context, id), "pos.view");
}

// POST { action: "begin", expectedVersion, idempotencyKey? }: lock the bill for payment (a changed total is shown instead); POST { action:
// "release", reason? }: back to the bill — refused while a payment on it is unresolved.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("begin"), expectedVersion: z.number().int(), idempotencyKey: z.string().min(8).max(100).optional() }),
    z.object({ action: z.literal("release"), reason: z.string().trim().max(200).optional() }),
  ]);
  return posMutation(request, schema, async (client, context, input) => (input.action === "begin"
    ? beginPosCheckout(client, context, id, input)
    : { ready: false, cart: await releasePosCheckout(client, context, id, input) }), 200, "pos.sale.create");
}
