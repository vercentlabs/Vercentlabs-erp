import { getDayEndContext } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: an outlet's current business day (?storeId, ?businessDate) and its earlier days still not closed.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({ context: await getDayEndContext(client, context, { storeId: params.get("storeId"), businessDate: params.get("businessDate") }) }), "pos.view");
}
