import { analyzeSupplierImport } from "@vercentlabs/api";

import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Import step 1: read the file and propose a column mapping. Multipart: file.
export async function POST(request: Request) {
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    return { analysis: await analyzeSupplierImport(client, context, { bytes: upload.bytes, fileName: upload.fileName }) };
  });
}
