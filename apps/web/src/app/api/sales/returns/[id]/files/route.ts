import { listReturnFiles, prepareReturnFileUpload, uploadReturnFile } from "@vercentlabs/api";

import { readUpload } from "@/features/sales/orders/server/order-http";
import { salesRead, salesUpload } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.return.view", async (client, context) => ({ files: await listReturnFiles(client, context, id) }));
}

// Multipart: file (the customer's request, photos, a signed receipt). The module checks who may add it.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesUpload(request, "sales.return.view", async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareReturnFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadReturnFile(client, context, id, { prepared }) };
  }, 201);
}
