import { getPosCheckoutPayments } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// The checkout's payments and balance, and its authoritative state (after a refresh or a lost connection, this is what happened).
export async function GET(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posRead(request, async (client, context) => ({ payments: await getPosCheckoutPayments(client, context, checkoutId) }), "pos.view");
}
