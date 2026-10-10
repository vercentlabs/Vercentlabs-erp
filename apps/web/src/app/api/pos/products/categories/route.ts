import { listPosProductCategories } from "@vercentlabs/api";

import { locatorOf, productRead } from "@/features/pos/products/server/product-route";

// The shared Item Categories the outlet sells from, flat with parents.
export async function GET(request: Request) {
  return productRead(request, (client, context) => listPosProductCategories(client, context, locatorOf(request)));
}
