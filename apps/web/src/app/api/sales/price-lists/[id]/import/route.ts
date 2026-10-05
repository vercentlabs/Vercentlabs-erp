import { buildPriceImportErrorFile, importPrices } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { type PriceListRouteParams, priceListUpload, readSpreadsheet } from "@/features/sales/price-lists/server/price-list-http";

// Multipart: file, mapping (JSON { header: field }), dryRun.
export async function POST(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListUpload(request, SALES_PERMISSIONS.priceListsImport, async (client, context) => {
    const upload = await readSpreadsheet(request);
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(upload.field("mapping") || "{}");
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const result = await importPrices(client, context, id, { bytes: upload.bytes, fileName: upload.fileName, mapping, dryRun: upload.field("dryRun") === "true" });
    return { result, errorFile: result.failed > 0 ? buildPriceImportErrorFile(result.results) : null };
  });
}
