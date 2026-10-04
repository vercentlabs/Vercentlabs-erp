import { analyzeProductImport } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productUpload, readFile } from "@/features/sales/products/server/product-http";

export async function POST(request: Request) {
  return productUpload(request, PRODUCT_PERMISSIONS.import, async (client, context) => {
    const upload = await readFile(request, { spreadsheetOnly: true });
    return { analysis: await analyzeProductImport(client, context, { bytes: upload.bytes, fileName: upload.fileName }) };
  });
}
