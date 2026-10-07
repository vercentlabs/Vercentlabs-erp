import { listPurchaseOrderFiles, preparePurchaseOrderFileUpload, uploadPurchaseOrderFile } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Files on the order. Multipart: file.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ files: await listPurchaseOrderFiles(client, context, id) }), "procurement.po.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await preparePurchaseOrderFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadPurchaseOrderFile(client, context, id, { prepared }) };
  }, 201);
}
