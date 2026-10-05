import { listInvoiceFiles, prepareInvoiceFileUpload, uploadInvoiceFile } from "@vercentlabs/api";

import { readUpload } from "@/features/sales/orders/server/order-http";
import { salesRead, salesUpload } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.invoice.view", async (client, context) => ({ files: await listInvoiceFiles(client, context, id) }));
}

// Multipart: file. The module checks who may add it; the type is checked from the bytes.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesUpload(request, "sales.invoice.view", async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareInvoiceFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadInvoiceFile(client, context, id, { prepared }) };
  }, 201);
}
