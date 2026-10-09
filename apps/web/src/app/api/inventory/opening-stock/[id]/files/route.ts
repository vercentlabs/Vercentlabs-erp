import { listOpeningStockFiles, prepareOpeningStockFileUpload, uploadOpeningStockFile } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead, inventoryUpload } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The migration evidence: legacy stock reports, count sheets, valuation workings. Multipart: file.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ files: await listOpeningStockFiles(client, context, id) }), OPENING_STOCK_PERMISSIONS.view);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryUpload(request, async (client, context, upload) => {
    const prepared = await prepareOpeningStockFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadOpeningStockFile(client, context, id, { prepared }) };
  }, 201, OPENING_STOCK_PERMISSIONS.view);
}
