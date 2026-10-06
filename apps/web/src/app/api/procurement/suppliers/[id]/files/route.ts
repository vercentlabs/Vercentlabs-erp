import { listSupplierFiles, prepareSupplierFileUpload, uploadSupplierFile } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ files: await listSupplierFiles(client, context, id) }));
}

// Multipart: file. The module checks who may add it; the type is checked from the name and the bytes.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareSupplierFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadSupplierFile(client, context, id, { prepared }) };
  }, 201);
}
