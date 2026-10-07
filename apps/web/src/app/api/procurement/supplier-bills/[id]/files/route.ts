import { listSupplierBillFiles, prepareSupplierBillFileUpload, uploadSupplierBillFile } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { readUpload, supplierUpload } from "@/features/procurement/suppliers/server/supplier-http";

// The supplier's original invoice and supporting documents. Multipart: file.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ files: await listSupplierBillFiles(client, context, id) }), "procurement.bills.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return supplierUpload(request, async (client, context) => {
    const upload = await readUpload(request);
    const prepared = await prepareSupplierBillFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadSupplierBillFile(client, context, id, { prepared }) };
  }, 201);
}
