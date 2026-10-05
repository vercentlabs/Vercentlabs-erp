import { buildPriceImportTemplate } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, priceListRead } from "@/features/sales/price-lists/server/price-list-http";

export async function GET(request: Request) {
  return priceListRead(request, SALES_PERMISSIONS.priceListsImport, async () => csvResponse(buildPriceImportTemplate(), "price-import-template.csv"));
}
