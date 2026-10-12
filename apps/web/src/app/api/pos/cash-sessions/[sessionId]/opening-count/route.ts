import { getPosCashOpeningCount } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ sessionId: string }> };

// GET: the confirmed opening count as recorded — amount, source, drawer, notes and coins, and the handover and difference for those who may see it.
export async function GET(request: Request, { params }: Params) {
  const { sessionId: id } = await params;
  return posRead(request, async (client, context) => ({ openingCount: await getPosCashOpeningCount(client, context, id) }), "pos.view");
}
