import { exportProducts } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, productFiltersFromUrl, productRead } from "@/features/sales/products/server/product-http";

export async function GET(request: Request) {
  return productRead(request, PRODUCT_PERMISSIONS.export, async (client, context) => {
    const exported = await exportProducts(client, context, productFiltersFromUrl(new URL(request.url)));
    return csvResponse(exported.csv, exported.fileName);
  });
}
