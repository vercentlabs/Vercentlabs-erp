import { getItemStock } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ itemId: string }> };

// One item: summary, warehouses, locations, reservations, incoming, outgoing, batches, serials and recent movements.
export async function GET(request: Request, { params }: Params) {
  const { itemId } = await params;
  return inventoryRead(request, async (client, context) => ({ stock: await getItemStock(client, context, itemId) }));
}
