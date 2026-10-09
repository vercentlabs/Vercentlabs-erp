import { listStockHoldFiles, prepareStockHoldFileUpload, uploadStockHoldFile } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead, inventoryUpload } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Evidence: inspection reports, photos, certificates, supplier correspondence. Multipart: file.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ files: await listStockHoldFiles(client, context, id) }), STOCK_HOLD_PERMISSIONS.view);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryUpload(request, async (client, context, upload) => {
    const prepared = await prepareStockHoldFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadStockHoldFile(client, context, id, { prepared }) };
  }, 201, STOCK_HOLD_PERMISSIONS.view);
}
