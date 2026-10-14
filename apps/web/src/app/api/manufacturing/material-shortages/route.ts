import { listMaterialShortages } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET the material shortages across open manufacturing orders (?warehouseId=&itemId=&status=). Checks manufacturing.material.view in the domain.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return manufacturingRead(request, async (client, context) => ({
    shortages: await listMaterialShortages(client, context, {
      warehouseId: params.get("warehouseId") || undefined, itemId: params.get("itemId") || undefined, status: params.get("status") || undefined,
    }),
  }));
}
