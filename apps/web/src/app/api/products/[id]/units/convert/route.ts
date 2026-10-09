import { convertBetweenUoms, convertUnitPrice } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead } from "@/features/items/server/item-http";

// ?quantity=&from=&to=[&unitPrice=] — a quantity (and optionally a unit price) of the item in one unit expressed in another, always
// through the base unit. exact is false when it does not divide evenly; such a value is for display only.
export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  const unitPrice = url.searchParams.get("unitPrice");
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({
    conversion: await convertBetweenUoms(client, context.organizationId, id, url.searchParams.get("quantity") ?? "1", from, to),
    price: unitPrice ? await convertUnitPrice(client, context.organizationId, id, unitPrice, from, to) : null,
  }));
}
