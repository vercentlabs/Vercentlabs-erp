import { buildProductImportTemplate } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, productRead } from "@/features/sales/products/server/product-http";

export async function GET(request: Request) {
  return productRead(request, PRODUCT_PERMISSIONS.import, async () => csvResponse(buildProductImportTemplate(), "product-import-template.csv"));
}
