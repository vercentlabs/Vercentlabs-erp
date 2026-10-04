import { buildCustomerImportErrorFile, importCustomers } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { customerUpload, readUpload } from "@/features/sales/customers/server/customer-http";

// Import step 2: validate (dryRun) or import. Multipart fields: file, mapping
// (JSON { header: field }), duplicateMode (skip | update | review), dryRun,
// countryCode and currencyCode (used for rows that leave them empty).
export async function POST(request: Request) {
  return customerUpload(request, SALES_PERMISSIONS.customersImport, async (client, context) => {
    const upload = await readUpload(request);
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(upload.field("mapping") || "{}");
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const result = await importCustomers(client, context, {
      bytes: upload.bytes,
      fileName: upload.fileName,
      mapping,
      duplicateMode: upload.field("duplicateMode") || "skip",
      dryRun: upload.field("dryRun") === "true",
      defaults: { countryCode: upload.field("countryCode"), currencyCode: upload.field("currencyCode") },
    });
    return { result, errorFile: result.failed + result.skipped + result.review > 0 ? buildCustomerImportErrorFile(result.results) : null };
  });
}
