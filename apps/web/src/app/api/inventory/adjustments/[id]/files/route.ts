import { listAdjustmentFiles, prepareAdjustmentFileUpload, uploadAdjustmentFile } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead, inventoryUpload } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Evidence: count sheets, reconciliation reports, photos, supervisor confirmations, migration evidence. Multipart: file.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ files: await listAdjustmentFiles(client, context, id) }), STOCK_ADJUSTMENT_PERMISSIONS.view);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryUpload(request, async (client, context, upload) => {
    const prepared = await prepareAdjustmentFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadAdjustmentFile(client, context, id, { prepared }) };
  }, 201, STOCK_ADJUSTMENT_PERMISSIONS.view);
}
