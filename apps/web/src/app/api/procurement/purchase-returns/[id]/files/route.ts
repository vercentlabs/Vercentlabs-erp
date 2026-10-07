import { listPurchaseReturnFiles, preparePurchaseReturnFileUpload, uploadPurchaseReturnFile } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Inspection reports, photographs, the supplier's correspondence. Multipart: file.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ files: await listPurchaseReturnFiles(client, context, id) }), "procurement.returns.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await preparePurchaseReturnFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadPurchaseReturnFile(client, context, id, { prepared }) };
  }, 201);
}
