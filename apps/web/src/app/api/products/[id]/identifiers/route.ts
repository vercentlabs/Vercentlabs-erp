import { addItemIdentifier, listItemIdentifiers } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead, productWrite } from "@/features/items/server/item-http";

// The item's barcodes and identifiers; ?includeRemoved=true adds the removed ones.
export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  const includeRemoved = new URL(request.url).searchParams.get("includeRemoved") === "true";
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ identifiers: await listItemIdentifiers(client, context, id, { includeRemoved }) }));
}

// body: { value, type, uomId?, isPrimary? }
export async function POST(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageIdentifiers, (client, context, body) => addItemIdentifier(client, context, id, body), 201);
}
