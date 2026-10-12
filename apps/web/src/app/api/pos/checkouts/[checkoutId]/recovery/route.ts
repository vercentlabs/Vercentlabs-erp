import { getPosSplitPaymentStatus } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// After a refresh or a lost connection: every part's real state, what was collected, what is still due, and what to do next.
export async function GET(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posRead(request, async (client, context) => ({ recovery: await getPosSplitPaymentStatus(client, context, checkoutId) }), "pos.view");
}
