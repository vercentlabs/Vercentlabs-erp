import { getProductOptions } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/sales/products/server/product-http";

export async function GET(request: Request) {
  return productRead(request, PRODUCT_PERMISSIONS.view, (client, context) => getProductOptions(client, context));
}
