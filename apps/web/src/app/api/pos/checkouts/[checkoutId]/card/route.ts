import { getPosCheckoutCardOptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// What this checkout can do with cards: the outlet's terminals, whether a standalone machine may be recorded, the amount due, and any card
// attempt still in progress on the bill (so a refreshed screen continues it instead of starting another).
export async function GET(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posRead(request, async (client, context) => ({ card: await getPosCheckoutCardOptions(client, context, checkoutId) }), "pos.view");
}
