import { searchPosProducts } from "@vercentlabs/api";

import { locatorOf, productRead } from "@/features/pos/products/server/product-route";

// ?q=&categoryId=&cursor=&limit=&cartId=&outletId= — name, SKU or barcode search, or browsing (no q), over the shared Item Master.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return productRead(request, (client, context) => searchPosProducts(client, context, {
    ...locatorOf(request),
    query: (params.get("q") ?? "").slice(0, 100),
    categoryId: /^[0-9a-f-]{36}$/i.test(params.get("categoryId") ?? "") ? params.get("categoryId") : null,
    cursor: (params.get("cursor") ?? "").slice(0, 400) || null,
    limit: Number(params.get("limit")) || undefined,
  }), { bucket: "search" });
}
