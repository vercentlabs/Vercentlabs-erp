import { lookupPosProductByBarcode } from "@vercentlabs/api";

import { locatorOf, productRead } from "@/features/pos/products/server/product-route";

type Params = { params: Promise<{ barcode: string }> };

// Exact barcode resolution: matched (auto-add when sellable now), ambiguous, selection required or not found — always a 200 with a status,
// so misses are logged and the scanner flow never treats "not found" as a failure.
export async function GET(request: Request, { params }: Params) {
  const { barcode } = await params;
  return productRead(request, (client, context) => lookupPosProductByBarcode(client, context, { ...locatorOf(request), barcode: decodeURIComponent(barcode) }),
    { bucket: "barcode" });
}
