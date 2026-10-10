import { getPosQuickProducts } from "@vercentlabs/api";

import { locatorOf, productRead } from "@/features/pos/products/server/product-route";

// The outlet's quick tiles: its shortlist, then its frequent sellers (up to 12).
export async function GET(request: Request) {
  return productRead(request, (client, context) => getPosQuickProducts(client, context, locatorOf(request)));
}
