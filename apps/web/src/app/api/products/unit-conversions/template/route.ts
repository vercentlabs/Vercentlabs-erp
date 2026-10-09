import { buildUomConversionTemplate } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, productRead } from "@/features/items/server/item-http";

export async function GET(request: Request) {
  return productRead(request, PRODUCT_PERMISSIONS.import, async () => csvResponse(buildUomConversionTemplate(), "unit-conversions-template.csv"));
}
