import { getBomOptions } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The BOM editor's pickers: products, materials and warehouses.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ options: await getBomOptions(client, context) }));
}
