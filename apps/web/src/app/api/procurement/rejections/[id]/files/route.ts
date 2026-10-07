import { listRejectionFiles, prepareRejectionFileUpload, uploadRejectionFile } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Evidence on a rejection: photos, inspection records, supplier correspondence. Multipart: file.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ files: await listRejectionFiles(client, context, id) }), "procurement.rejections.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareRejectionFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadRejectionFile(client, context, id, { prepared }) };
  }, 201);
}
