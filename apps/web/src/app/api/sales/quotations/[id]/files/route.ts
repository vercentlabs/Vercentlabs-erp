import { listQuotationFiles, prepareQuotationFileUpload, uploadQuotationFile } from "@vercentlabs/api";

import { readUpload } from "@/features/sales/quotations/server/quotation-http";
import { salesRead, salesUpload } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.quotation.view", async (client, context) => ({ files: await listQuotationFiles(client, context, id) }));
}

// Multipart: file. The type is checked from the bytes.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesUpload(request, "sales.quotation.create", async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareQuotationFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadQuotationFile(client, context, id, { prepared }) };
  }, 201);
}
