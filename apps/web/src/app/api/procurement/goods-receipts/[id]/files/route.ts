import { listGoodsReceiptFiles, prepareGoodsReceiptFileUpload, uploadGoodsReceiptFile } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Files on the receipt: the challan, packing slips, photos of damaged goods. Multipart: file.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ files: await listGoodsReceiptFiles(client, context, id) }), "procurement.po.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareGoodsReceiptFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadGoodsReceiptFile(client, context, id, { prepared }) };
  }, 201);
}
