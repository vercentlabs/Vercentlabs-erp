import { importSupplierRates } from "@vercentlabs/api";

import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Supplier Rates from a CSV or Excel file (multipart: file, dryRun). A check run saves nothing and lists each row's problem.
export async function POST(request: Request) {
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    return { result: await importSupplierRates(client, context, { bytes: upload.bytes, fileName: upload.fileName, dryRun: upload.field("dryRun") === "true" }) };
  });
}
