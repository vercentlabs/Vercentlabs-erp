import { analyzePriceImport } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type PriceListRouteParams, priceListUpload, readSpreadsheet } from "@/features/sales/price-lists/server/price-list-http";

export async function POST(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListUpload(request, SALES_PERMISSIONS.priceListsImport, async (client, context) => {
    const upload = await readSpreadsheet(request);
    return { analysis: await analyzePriceImport(client, context, id, { bytes: upload.bytes, fileName: upload.fileName }) };
  });
}
