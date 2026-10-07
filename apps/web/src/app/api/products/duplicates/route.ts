import { findDuplicateProducts } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productWrite } from "@/features/items/server/item-http";

// Checks a product being typed in. POST because the probe is a body; nothing is saved.
export async function POST(request: Request) {
  return productWrite(request, PRODUCT_PERMISSIONS.view, (client, context, body) =>
    findDuplicateProducts(client, context, body, { excludeId: typeof body.excludeId === "string" ? body.excludeId : null }));
}
