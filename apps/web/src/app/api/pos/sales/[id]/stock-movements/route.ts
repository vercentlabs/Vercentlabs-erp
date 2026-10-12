import { getPosSaleStockMovements } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the sale's Inventory movements — one or more per stocked line, the reservation each consumed, its cost from Inventory valuation — and
// whether the sale's quantities and the movements agree.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ stock: await getPosSaleStockMovements(client, context, id) }), "pos.view");
}
