import { lookupPosProductByBarcode } from "@vercentlabs/api";

import { locatorOf, productRead } from "@/features/pos/products/server/product-route";

// ?barcode=&cartId= — exact barcode resolution in the shared registry (no cart change): matched, ambiguous, selection required, inactive,
// unreadable or not found.
export async function GET(request: Request) {
  const barcode = new URL(request.url).searchParams.get("barcode") ?? "";
  return productRead(request, (client, context) => lookupPosProductByBarcode(client, context, { ...locatorOf(request), barcode }), { bucket: "barcode" });
}
