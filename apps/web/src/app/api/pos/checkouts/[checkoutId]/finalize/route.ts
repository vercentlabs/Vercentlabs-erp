import { z } from "zod";

import { finalizeSplitCheckout } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// Finalise the bill once every part is confirmed and they add up exactly (one sale, one invoice); otherwise say what is still missing.
export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, z.object({}).passthrough(), async (client, context) => ({ split: await finalizeSplitCheckout(client, context, checkoutId) }), 200, "pos.sale.create");
}
