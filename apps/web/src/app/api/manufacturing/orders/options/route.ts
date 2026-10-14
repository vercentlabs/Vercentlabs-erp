import { getManufacturingOrderOptions } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// What a new order chooses from: products with an effective BOM, warehouses, people and open sales orders.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ options: await getManufacturingOrderOptions(client, context) }));
}
