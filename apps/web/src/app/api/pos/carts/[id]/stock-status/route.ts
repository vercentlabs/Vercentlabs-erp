import { getPosCheckoutStockStatus } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the bill's stock at checkout — per line what is reserved at the outlet's warehouse (location, batch, serial, until when), what was
// available before, what the sale consumed; overall RESERVED / EXPIRED / CONSUMED / RECOVERY_REQUIRED and any stock recovery.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ stock: await getPosCheckoutStockStatus(client, context, id) }), "pos.sale.create");
}
