import { getPosRefund } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string }> };

// GET: the refund's per-method outcomes.
export async function GET(request: Request, { params }: Params) {
  const { refundId } = await params;
  return posRead(request, async (client, context) => {
    const refund = await getPosRefund(client, context, refundId);
    return { status: refund.status, components: refund.components };
  }, "pos.view");
}
