import { buildSupplierImportErrorFile, importSuppliers } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Import step 2: validate (dryRun) or import. Multipart: file, mapping (JSON { header: field }), dryRun, and the defaults used where a row
// leaves them empty: countryCode, currency, paymentTermId, category.
export async function POST(request: Request) {
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(upload.field("mapping") || "{}");
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const result = await importSuppliers(client, context, {
      bytes: upload.bytes, fileName: upload.fileName, mapping, dryRun: upload.field("dryRun") === "true",
      defaults: { countryCode: upload.field("countryCode"), currency: upload.field("currency"), paymentTermId: upload.field("paymentTermId") || undefined, category: upload.field("category") },
    });
    return { result, errorFile: result.duplicates + result.failed > 0 ? buildSupplierImportErrorFile(result.results) : null };
  });
}
