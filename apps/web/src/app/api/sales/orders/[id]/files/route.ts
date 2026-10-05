import { listSalesOrderFiles, prepareSalesOrderFileUpload, uploadSalesOrderFile } from "@vercentlabs/api";

import { readUpload } from "@/features/sales/orders/server/order-http";
import { salesRead, salesUpload } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ files: await listSalesOrderFiles(client, context, id) }));
}

// Multipart: file (the customer's PO, an agreement, a drawing). The type is checked from the bytes.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesUpload(request, "sales.order.create", async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareSalesOrderFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadSalesOrderFile(client, context, id, { prepared }) };
  }, 201);
}
