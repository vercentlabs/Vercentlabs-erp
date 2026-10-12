import { getSettlementBatch } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ batchId: string }> };

// GET: a settlement — gross to net, its lines and their matches, its bank receipts.
export async function GET(request: Request, { params }: Params) {
  const { batchId } = await params;
  return posRead(request, async (client, context) => ({ settlement: await getSettlementBatch(client, context, batchId) }), "pos.view");
}
