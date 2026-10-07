import { activateProduct, deactivateProduct } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { type ProductRouteParams, productWrite } from "@/features/items/server/item-http";

// body: { action: activate | deactivate, reason? }
export async function POST(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.activate, async (client, context, body) => {
    if (body.action !== "activate" && body.action !== "deactivate") throw new HttpError(400, "Unknown status action.");
    const run = body.action === "activate" ? activateProduct : deactivateProduct;
    return { product: await run(client, context, id, { reason: body.reason }) };
  });
}
