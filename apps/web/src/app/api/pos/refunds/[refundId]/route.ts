import { getPosRefund } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string }> };

// GET: the refund — authorized, paid, processing, waiting and outstanding; each component's status; every attempt; reconciliation exceptions.
export async function GET(request: Request, { params }: Params) {
  const { refundId } = await params;
  return posRead(request, async (client, context) => ({ refund: await getPosRefund(client, context, refundId) }), "pos.view");
}
