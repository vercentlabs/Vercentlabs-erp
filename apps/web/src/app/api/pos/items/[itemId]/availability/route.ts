import { getPosItemStock } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ itemId: string }> };

// GET ?terminalId= | ?outletId= | ?cartId=: one item's stock at that outlet's warehouse (and the terminal's selling location) — available and
// its status for everyone; on hand, reserved and non-sellable only for users who may see Inventory; eligible batches and serial numbers for
// tracked items; the inventory version. Informational: checkout reserves atomically.
export async function GET(request: Request, { params }: Params) {
  const { itemId } = await params;
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    availability: await getPosItemStock(client, context, itemId, { terminalId: search.get("terminalId"), outletId: search.get("outletId"), cartId: search.get("cartId") }),
  }), "pos.view");
}
