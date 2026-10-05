import { listDeliveryFiles, prepareDeliveryFileUpload, uploadDeliveryFile } from "@vercentlabs/api";

import { readUpload } from "@/features/sales/orders/server/order-http";
import { salesRead, salesUpload } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.delivery.view", async (client, context) => ({ files: await listDeliveryFiles(client, context, id) }));
}

// Multipart: file (proof of delivery: the signed delivery note, a photo). The module checks who may add it; the type is checked from the bytes.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesUpload(request, "sales.delivery.view", async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareDeliveryFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadDeliveryFile(client, context, id, { prepared }) };
  }, 201);
}
