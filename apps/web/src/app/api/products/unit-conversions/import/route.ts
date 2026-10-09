import { importItemUomConversions } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productUpload, readFile } from "@/features/items/server/item-http";

// Multipart: file (SKU, Unit, Conversion to base, Purchasing, Sales, Inventory, Status), dryRun, acknowledgeHistory.
export async function POST(request: Request) {
  return productUpload(request, PRODUCT_PERMISSIONS.import, async (client, context) => {
    const upload = await readFile(request, { spreadsheetOnly: true });
    return {
      result: await importItemUomConversions(client, context, {
        bytes: upload.bytes, fileName: upload.fileName, dryRun: upload.field("dryRun") === "true", acknowledgeHistory: upload.field("acknowledgeHistory") === "true",
      }),
    };
  });
}
