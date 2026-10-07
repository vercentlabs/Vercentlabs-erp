import { buildProductImportErrorFile, importProducts } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { productUpload, readFile } from "@/features/items/server/item-http";

// Multipart: file, mapping (JSON { header: field }), existing (skip | update), dryRun.
export async function POST(request: Request) {
  return productUpload(request, PRODUCT_PERMISSIONS.import, async (client, context) => {
    const upload = await readFile(request, { spreadsheetOnly: true });
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(upload.field("mapping") || "{}");
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const result = await importProducts(client, context, {
      bytes: upload.bytes, fileName: upload.fileName, mapping, existing: upload.field("existing") || "skip", dryRun: upload.field("dryRun") === "true",
    });
    return { result, errorFile: result.failed + result.skipped > 0 ? buildProductImportErrorFile(result.results) : null };
  });
}
