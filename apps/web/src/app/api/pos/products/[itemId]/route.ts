import { getPosProductDetails } from "@vercentlabs/api";

import { locatorOf, productRead } from "@/features/pos/products/server/product-route";

type Params = { params: Promise<{ itemId: string }> };

// One product for selection: its units (each priced, with stock) and its variants.
export async function GET(request: Request, { params }: Params) {
  const { itemId } = await params;
  return productRead(request, (client, context) => getPosProductDetails(client, context, itemId, locatorOf(request)));
}
